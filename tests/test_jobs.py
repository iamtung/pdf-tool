import os
import time

import pytest

from pdftool.jobs import JobManager


@pytest.fixture(autouse=True)
def allow_test_tasks(monkeypatch):
    # spawned workers inherit os.environ, so this must be set before submit()
    monkeypatch.setenv("PDFTOOL_ALLOW_TEST_TASKS", "1")


@pytest.fixture
def manager():
    m = JobManager()
    yield m
    m.shutdown()


def test_analysis_job_runs_in_process(manager, mixed, pdftool_home):
    job = manager.submit("analysis", {"path": str(mixed), "fingerprint": "fp1"})
    job = manager.wait(job.id)
    assert job.status == "done", job.error
    assert job.result["pageCount"] == 5
    assert (pdftool_home / "cache" / "analysis" / "fp1.json").exists()
    assert not list((pdftool_home / "tmp").glob("job-*"))


def test_profile_job_caches_analysis_and_profile(manager, vector3, pdftool_home):
    job = manager.wait(manager.submit("profile", {"path": str(vector3), "fingerprint": "fpP"}).id)
    assert job.status == "done", job.error
    assert job.result["version"] == 1
    assert (pdftool_home / "cache" / "analysis" / "fpP.json").exists()
    assert (pdftool_home / "cache" / "profile" / "fpP.json").exists()


def test_error_is_reported(manager, tmp_path):
    job = manager.wait(manager.submit("export", {
        "plan": {"pages": []}, "sources": {}, "destDir": str(tmp_path), "baseName": "x",
    }).id)
    assert job.status == "failed"
    assert job.error["code"] == "bad_request"


def test_cancel_terminates(manager, scans, tmp_path):
    job = manager.submit("export", {
        "plan": {"pages": [{"id": f"p{i}", "source": {"type": "pdf", "docId": "a", "index": i}} for i in range(4)],
                 "fileCompression": {"targetMB": 0.01}},
        "sources": {"a": {"path": str(scans)}}, "destDir": str(tmp_path / "out"), "baseName": "x",
    }, exclusive=True)
    while job.status == "queued":
        time.sleep(0.05)
    manager.cancel(job.id)
    assert job.status == "cancelled"
    time.sleep(0.5)
    assert job.status == "cancelled"
    out = tmp_path / "out"
    assert not out.exists() or not list(out.glob("*.pdf"))


def test_cancel_removes_partial_destination_file(manager, scans, tmp_path, pdftool_home):
    job = manager.submit("export", {
        "plan": {"pages": [{"id": f"p{i}", "source": {"type": "pdf", "docId": "a", "index": i}} for i in range(4)],
                 "fileCompression": {"targetMB": 0.01}},
        "sources": {"a": {"path": str(scans)}}, "destDir": str(tmp_path / "out"), "baseName": "x",
    }, exclusive=True)
    while job.status == "queued":
        time.sleep(0.05)
    out = tmp_path / "out"
    out.mkdir(parents=True, exist_ok=True)
    partial = out / "x_compressed.abcd1234.tmp.pdf"
    partial.write_bytes(b"partial")
    workdir = pdftool_home / "tmp" / f"job-{job.id}"
    workdir.mkdir(parents=True, exist_ok=True)
    (workdir / "dest-tmp.txt").write_text(f"{partial}\n", encoding="utf-8")
    manager.cancel(job.id)
    assert job.status == "cancelled"
    time.sleep(0.5)
    assert not partial.exists()


def test_exclusive_jobs_run_one_at_a_time(manager, vector3, tmp_path):
    args = {
        "plan": {"pages": [{"id": "p0", "source": {"type": "pdf", "docId": "a", "index": 0}}]},
        "sources": {"a": {"path": str(vector3)}}, "destDir": str(tmp_path / "o"), "baseName": "x",
    }
    a = manager.submit("export", args, exclusive=True)
    b = manager.submit("export", args, exclusive=True)
    assert manager.wait(a.id).status == "done"
    assert manager.wait(b.id).status == "done"
    names = sorted(p.name for p in (tmp_path / "o").glob("*.pdf"))
    assert names == ["x_edited (2).pdf", "x_edited.pdf"]


def _wait_for(pred, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(0.05)
    return pred()


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _start_sleeper(manager, tmp_path, **kw):
    pid_file = tmp_path / "child.pid"
    job = manager.submit("tests.helpers:spawn_sleeper", {"pidFile": str(pid_file)}, **kw)
    assert _wait_for(pid_file.exists, 10), job.public()
    return job, int(pid_file.read_text())


def test_cancel_kills_worker_children(manager, tmp_path):
    job, child = _start_sleeper(manager, tmp_path)
    assert _pid_alive(child)
    manager.cancel(job.id)
    assert job.status == "cancelled"
    assert _wait_for(lambda: not _pid_alive(child), 3), "worker's child survived cancel"


def test_shutdown_kills_running_jobs(manager, tmp_path):
    job, child = _start_sleeper(manager, tmp_path)
    manager.shutdown()
    assert job.status == "cancelled"
    assert _wait_for(lambda: not _pid_alive(child), 3)


def test_cancelled_job_stays_cancelled_when_worker_finishes(manager):
    job = manager.submit("tests.helpers:quick", {"delay": 0.3})
    assert _wait_for(lambda: job.status == "running")
    manager.cancel(job.id)
    time.sleep(1.0)
    assert job.status == "cancelled"
    assert job.result is None


def test_cancel_after_done_is_noop(manager):
    job = manager.wait(manager.submit("tests.helpers:quick", {}).id)
    assert job.status == "done"
    version = job.version
    assert manager.cancel(job.id) is job
    assert job.status == "done" and job.version == version and job.result == {"ok": True}


def test_cancel_queued_exclusive_never_runs(manager, vector3, tmp_path):
    blocker = manager.submit("tests.helpers:quick", {"delay": 0.8}, exclusive=True)
    marker = tmp_path / "ran.txt"
    queued = manager.submit("tests.helpers:quick", {"marker": str(marker)}, exclusive=True)
    time.sleep(0.2)
    assert queued.status == "queued"
    manager.cancel(queued.id)
    assert queued.status == "cancelled"
    assert manager.wait(blocker.id).status == "done"
    export = manager.submit("export", {
        "plan": {"pages": [{"id": "p0", "source": {"type": "pdf", "docId": "a", "index": 0}}]},
        "sources": {"a": {"path": str(vector3)}}, "destDir": str(tmp_path / "o"), "baseName": "x",
    }, exclusive=True)
    assert manager.wait(export.id, timeout=30).status == "done", export.error
    assert not marker.exists()
    assert queued.status == "cancelled"


def test_large_result_arrives_intact(manager):
    job = manager.wait(manager.submit("tests.helpers:big_result", {"size": 5_000_000}).id)
    assert job.status == "done", job.error
    assert len(job.result["blob"]) == 5_000_000 and set(job.result["blob"]) == {"x"}
    assert job.result["items"] == list(range(10_000))


def test_unexpected_error_message(manager):
    job = manager.wait(manager.submit("tests.helpers:boom", {"secret": "hunter2"}).id)
    assert job.status == "failed"
    assert job.error == {"code": "internal", "message": "RuntimeError: kaboom"}


def test_dedup_key_is_not_a_job_id(manager):
    job = manager.submit("tests.helpers:quick", {"delay": 1.0}, key="fp9")
    assert manager.get("tests.helpers:quick:fp9") is None
    assert manager.find_active("tests.helpers:quick", "fp9") is job
    assert manager.get(job.id) is job
    manager.wait(job.id)
    assert manager.find_active("tests.helpers:quick", "fp9") is None


def test_finished_jobs_are_pruned(manager):
    old = manager.wait(manager.submit("tests.helpers:quick", {}).id)
    old._finished_at -= 31 * 60
    manager.submit("tests.helpers:quick", {})
    assert manager.get(old.id) is None


def test_test_kinds_need_opt_in(manager, monkeypatch):
    monkeypatch.delenv("PDFTOOL_ALLOW_TEST_TASKS")
    job = manager.wait(manager.submit("tests.helpers:quick", {}).id)
    assert job.status == "failed"
    assert job.error["code"] == "internal"
    job = manager.wait(manager.submit("nope", {}).id)
    assert job.status == "failed" and job.error["code"] == "internal"


def test_shutdown_cleans_up_before_returning(manager, tmp_path, pdftool_home):
    job, child = _start_sleeper(manager, tmp_path)
    workdir = pdftool_home / "tmp" / f"job-{job.id}"
    workdir.mkdir(parents=True, exist_ok=True)
    partial = tmp_path / "out" / "x_compressed.abcd.tmp.pdf"
    partial.parent.mkdir()
    partial.write_bytes(b"partial")
    (workdir / "dest-tmp.txt").write_text(f"{partial}\n", encoding="utf-8")
    manager.shutdown()
    assert not partial.exists()
    assert not workdir.exists()
    assert _wait_for(lambda: not _pid_alive(child), 3)


def test_sweep_stale_removes_leftover_workdirs(tmp_path, pdftool_home):
    stale = pdftool_home / "tmp" / "job-deadbeef0000"
    stale.mkdir(parents=True)
    partial = tmp_path / "x_compressed.1234.tmp.pdf"
    partial.write_bytes(b"partial")
    keep = tmp_path / "x_compressed.pdf"
    keep.write_bytes(b"final")
    (stale / "dest-tmp.txt").write_text(f"{partial}\n{keep}\n", encoding="utf-8")
    (pdftool_home / "tmp" / "unrelated").mkdir()
    m = JobManager()
    assert m.sweep_stale() == [stale]
    assert not stale.exists() and not partial.exists()
    assert keep.exists() and (pdftool_home / "tmp" / "unrelated").exists()
