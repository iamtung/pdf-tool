"""Background jobs, one process each so they can be cancelled (spec §4.8).

Progress flows child -> parent through a multiprocessing queue. A watcher thread per
job copies events into the Job object; the SSE endpoint polls that object.
"""
import multiprocessing as mp
import queue
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field

from pdftool import paths

TERMINAL = {"done", "failed", "cancelled"}


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"
    progress: float = 0.0
    message: str = ""
    result: dict | None = None
    error: dict | None = None
    version: int = 0
    _proc: mp.Process | None = field(default=None, repr=False)
    _cancel: bool = field(default=False, repr=False)

    def public(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "status": self.status,
            "progress": round(self.progress * 100), "message": self.message,
            "result": self.result, "error": self.error,
        }


def _worker(kind: str, args: dict, q) -> None:
    from pdftool.core.errors import PdfToolError
    from pdftool.tasks import TASKS

    try:
        result = TASKS[kind](args, lambda f, m="": q.put(("progress", float(f), m)))
        q.put(("done", result))
    except PdfToolError as e:
        q.put(("error", {"code": e.code, "message": e.message}))
    except Exception as e:  # noqa: BLE001 - surface anything to the UI
        q.put(("error", {"code": "internal", "message": f"{type(e).__name__}: {e}"}))


class JobManager:
    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._exclusive = threading.Lock()  # one export at a time
        self._ctx = mp.get_context("spawn")

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def find_active(self, kind: str, key: str) -> Job | None:
        job = self._jobs.get(f"{kind}:{key}")
        return job if job and job.status not in TERMINAL else None

    def submit(self, kind: str, args: dict, *, exclusive: bool = False, key: str | None = None) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind)
        workdir = paths.tmp_dir() / f"job-{job.id}"
        args = {**args, "workdir": str(workdir)}
        self._jobs[job.id] = job
        if key:
            self._jobs[f"{kind}:{key}"] = job
        threading.Thread(target=self._run, args=(job, args, exclusive, workdir), daemon=True).start()
        return job

    def _update(self, job: Job, **kw) -> None:
        for k, v in kw.items():
            setattr(job, k, v)
        job.version += 1

    def _run(self, job: Job, args: dict, exclusive: bool, workdir) -> None:
        lock = self._exclusive if exclusive else None
        if lock:
            lock.acquire()
        try:
            if job._cancel:
                return
            q = self._ctx.Queue()
            proc = self._ctx.Process(target=_worker, args=(job.kind, args, q), daemon=True)
            job._proc = proc
            self._update(job, status="running")
            proc.start()
            while True:
                try:
                    event = q.get(timeout=0.2)
                except queue.Empty:
                    if job._cancel:
                        # cancel() may have raced with start(): make sure the child is gone
                        if proc.is_alive():
                            proc.terminate()
                            proc.join(timeout=5)
                        return
                    if not proc.is_alive():
                        # drain anything written right before exit
                        try:
                            event = q.get(timeout=0.5)
                        except queue.Empty:
                            self._update(job, status="failed", error={"code": "internal", "message": "Tiến trình xử lý bị dừng đột ngột."})
                            return
                    else:
                        continue
                if event[0] == "progress":
                    self._update(job, progress=event[1], message=event[2])
                elif event[0] == "done":
                    self._update(job, status="done", progress=1.0, result=event[1], message="Xong")
                    break
                elif event[0] == "error":
                    self._update(job, status="failed", error=event[1])
                    break
            proc.join(timeout=5)
        finally:
            if lock:
                lock.release()
            if job._cancel:
                from pdftool.core.export import cleanup_dest_tmp

                cleanup_dest_tmp(workdir)
            shutil.rmtree(workdir, ignore_errors=True)

    def cancel(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None or job.status in TERMINAL:
            return job
        job._cancel = True
        if job._proc is not None and job._proc.is_alive():
            job._proc.terminate()
            job._proc.join(timeout=5)
        self._update(job, status="cancelled", message="Đã hủy")
        return job

    def wait(self, job_id: str, timeout: float = 120) -> Job:
        """Block until the job finishes (used by tests)."""
        deadline = time.time() + timeout
        job = self._jobs[job_id]
        while job.status not in TERMINAL and time.time() < deadline:
            time.sleep(0.05)
        return job
