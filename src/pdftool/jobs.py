"""Background jobs, one process each so they can be cancelled (spec §4.8).

Progress flows child -> parent through a one-way pipe. A watcher thread per job copies
events into the Job object; the SSE endpoint polls that object (``Job.version``).

Cancellation rules:
- every worker is the leader of its own process group, so cancelling kills the worker
  *and* anything it spawned (Ghostscript);
- all status transitions happen under one manager lock and terminal statuses are final;
- once ``_cancel`` is set the watcher stops reading and ignores anything the worker sends.
"""
import atexit
import multiprocessing as mp
import os
import shutil
import signal
import threading
import time
import uuid
import weakref
from dataclasses import dataclass, field
from multiprocessing.connection import wait as mp_wait
from pathlib import Path

from pdftool import paths

TERMINAL = {"done", "failed", "cancelled"}

_KEEP_FINISHED_S = 30 * 60
_MAX_JOBS = 200
_TERM_GRACE_S = 1.0
_SHUTDOWN_JOIN_S = 2.0  # per job
_SHUTDOWN_TOTAL_S = 10.0


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
    _finished_at: float | None = field(default=None, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)

    def public(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "status": self.status,
            "progress": round(self.progress * 100), "message": self.message,
            "result": self.result, "error": self.error,
        }


def _resolve_task(kind: str):
    """Look up a worker entry point.

    ``module:function`` kinds are for tests only and need ``PDFTOOL_ALLOW_TEST_TASKS=1``.
    """
    if ":" in kind:
        if os.environ.get("PDFTOOL_ALLOW_TEST_TASKS") != "1":
            raise ValueError(f"unknown job kind {kind!r}")
        import importlib

        mod, _, name = kind.partition(":")
        return getattr(importlib.import_module(mod), name)
    from pdftool.tasks import TASKS

    if kind not in TASKS:
        raise ValueError(f"unknown job kind {kind!r}")
    return TASKS[kind]


def _worker(kind: str, args: dict, conn) -> None:
    os.setpgrp()  # own process group: cancel() kills us and our children together
    parent = os.getppid()
    from pdftool.core.errors import PdfToolError

    def progress(f, m=""):
        if os.getppid() != parent:  # server died without cancelling us: stop working
            os._exit(1)
        conn.send(("progress", float(f), m))

    try:
        fn = _resolve_task(kind)
        result = fn(args, progress)
        conn.send(("done", result))
    except PdfToolError as e:
        conn.send(("error", {"code": e.code, "message": e.message}))
    except Exception as e:  # noqa: BLE001 - surface anything to the UI (never the job args)
        conn.send(("error", {"code": "internal", "message": f"{type(e).__name__}: {e}"}))
    finally:
        conn.close()


def _signal_group(pid: int, sig: int) -> bool:
    try:
        os.killpg(pid, sig)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def _kill_process_tree(proc: mp.Process) -> None:
    """SIGTERM the worker's process group, then SIGKILL whatever is left."""
    pid = proc.pid
    if pid is None:  # never started
        return
    if not _signal_group(pid, signal.SIGTERM) and proc.is_alive():
        # the child may not have called setpgrp() yet (so it has no children either)
        proc.terminate()
    proc.join(timeout=_TERM_GRACE_S)
    # Always sweep the group: grandchildren may ignore SIGTERM or outlive the leader.
    _signal_group(pid, signal.SIGKILL)
    if proc.is_alive():
        proc.kill()
        proc.join(timeout=5)


def _shutdown_ref(ref) -> None:
    manager = ref()
    if manager is not None:
        manager.shutdown()


class JobManager:
    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._active: dict[str, str] = {}  # "kind:key" -> job id (dedup for find_active)
        self._lock = threading.RLock()  # guards _jobs/_active and every status transition
        self._exclusive = threading.Lock()  # one export at a time
        self._ctx = mp.get_context("spawn")
        atexit.register(_shutdown_ref, weakref.ref(self))

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def find_active(self, kind: str, key: str) -> Job | None:
        with self._lock:
            job_id = self._active.get(f"{kind}:{key}")
            job = self._jobs.get(job_id) if job_id else None
            return job if job and job.status not in TERMINAL else None

    def submit(self, kind: str, args: dict, *, exclusive: bool = False, key: str | None = None) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind)
        workdir = paths.tmp_dir() / f"job-{job.id}"
        args = {**args, "workdir": str(workdir)}
        with self._lock:
            self._prune()
            self._jobs[job.id] = job
            if key:
                self._active[f"{kind}:{key}"] = job.id
        job._thread = threading.Thread(target=self._run, args=(job, args, exclusive, workdir), daemon=True)
        job._thread.start()
        return job

    def sweep_stale(self) -> list[Path]:
        """Remove leftovers of jobs from a previous server run (e.g. after SIGKILL).

        Call once at startup, before any job is submitted: every ``tmp/job-*`` dir is
        treated as stale. Partial destination files listed in its manifest are deleted too.
        """
        from pdftool.core.export import cleanup_dest_tmp

        root = paths.tmp_dir()
        if not root.is_dir():
            return []
        with self._lock:
            live = {f"job-{j.id}" for j in self._jobs.values() if j.status not in TERMINAL}
        removed = []
        for d in root.glob("job-*"):
            if not d.is_dir() or d.name in live:
                continue
            try:
                cleanup_dest_tmp(d)
            except OSError:
                pass
            shutil.rmtree(d, ignore_errors=True)
            removed.append(d)
        return removed

    def _prune(self) -> None:
        """Forget finished jobs older than 30 minutes; cap the table at ~_MAX_JOBS."""
        now = time.time()
        finished = sorted(
            (j for j in self._jobs.values() if j.status in TERMINAL and j._finished_at is not None),
            key=lambda j: j._finished_at,
        )
        excess = max(0, len(self._jobs) + 1 - _MAX_JOBS)
        for i, j in enumerate(finished):
            if i < excess or now - j._finished_at > _KEEP_FINISHED_S:
                del self._jobs[j.id]
        live = set(self._jobs)
        self._active = {k: v for k, v in self._active.items() if v in live}

    def _update(self, job: Job, **kw) -> bool:
        """Apply a change unless the job is already final. Returns whether it was applied."""
        with self._lock:
            if job.status in TERMINAL:
                return False
            if job._cancel and kw.get("status") != "cancelled":
                return False  # after cancel only the cancel itself may land
            for k, v in kw.items():
                setattr(job, k, v)
            if job.status in TERMINAL:
                job._finished_at = time.time()
            job.version += 1
            return True

    def _run(self, job: Job, args: dict, exclusive: bool, workdir) -> None:
        lock = self._exclusive if exclusive else None
        if lock:
            lock.acquire()
        try:
            recv_conn, send_conn = self._ctx.Pipe(duplex=False)
            proc = self._ctx.Process(target=_worker, args=(job.kind, args, send_conn), daemon=True)
            with self._lock:
                if job._cancel:
                    send_conn.close()
                    recv_conn.close()
                    return
                # Start under the lock so cancel() either sees no process (and we bail out
                # above) or sees a started process it can kill.
                try:
                    proc.start()
                except Exception as e:  # e.g. fork/spawn failure (EAGAIN, EMFILE)
                    send_conn.close()
                    recv_conn.close()
                    self._update(job, status="failed", error={
                        "code": "internal", "message": f"Không khởi chạy được tác vụ: {type(e).__name__}"})
                    return
                job._proc = proc
            send_conn.close()  # the child's death now gives us EOF
            try:
                if self._update(job, status="running"):
                    self._watch(job, proc, recv_conn)
            finally:
                recv_conn.close()
            if job._cancel:
                _kill_process_tree(proc)  # usually already done by cancel(); idempotent
            else:
                proc.join(timeout=5)
                if proc.is_alive():
                    _kill_process_tree(proc)
        finally:
            if lock:
                lock.release()
            if job._cancel:
                from pdftool.core.export import cleanup_dest_tmp

                try:
                    cleanup_dest_tmp(workdir)
                except OSError:
                    pass
            shutil.rmtree(workdir, ignore_errors=True)

    def _watch(self, job: Job, proc: mp.Process, conn) -> None:
        died = {"code": "internal", "message": "Tiến trình xử lý bị dừng đột ngột."}
        while not job._cancel:
            ready = mp_wait([conn, proc.sentinel], timeout=0.2)
            if job._cancel:
                return  # never read after a cancel/terminate
            if not ready:
                continue
            if conn not in ready:
                # worker exited; give any last message a moment, else it died
                if conn.poll(0.5):
                    continue
                self._update(job, status="failed", error=died)
                return
            try:
                event = conn.recv()
            except (EOFError, OSError):
                self._update(job, status="failed", error=died)
                return
            if event[0] == "progress":
                self._update(job, progress=event[1], message=event[2])
            elif event[0] == "done":
                self._update(job, status="done", progress=1.0, result=event[1], message="Xong")
                return
            elif event[0] == "error":
                self._update(job, status="failed", error=event[1])
                return

    def cancel(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL:
                return job
            job._cancel = True
            proc = job._proc
            self._update(job, status="cancelled", message="Đã hủy")
        if proc is not None:
            _kill_process_tree(proc)
        return job

    def shutdown(self) -> None:
        """Cancel every unfinished job and kill its process group (FastAPI lifespan / atexit)."""
        with self._lock:
            jobs = [j for j in self._jobs.values() if j.status not in TERMINAL]
        for job in jobs:
            self.cancel(job.id)
        # Let each watcher run its cleanup (dest tmp files, workdir) before we exit.
        deadline = time.monotonic() + _SHUTDOWN_TOTAL_S
        for job in jobs:
            t = job._thread
            remaining = deadline - time.monotonic()
            if t is not None and t is not threading.current_thread() and remaining > 0:
                t.join(timeout=min(_SHUTDOWN_JOIN_S, remaining))

    def wait(self, job_id: str, timeout: float = 120) -> Job:
        """Block until the job finishes (used by tests)."""
        deadline = time.time() + timeout
        job = self._jobs[job_id]
        while job.status not in TERMINAL and time.time() < deadline:
            time.sleep(0.05)
        return job
