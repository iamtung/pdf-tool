import time

import pytest

from pdftool.jobs import JobManager


@pytest.fixture
def manager():
    return JobManager()


def test_analysis_job_runs_in_process(manager, mixed, pdftool_home):
    job = manager.submit("analysis", {"path": str(mixed), "fingerprint": "fp1"})
    job = manager.wait(job.id)
    assert job.status == "done", job.error
    assert job.result["pageCount"] == 5
    assert (pdftool_home / "cache" / "analysis" / "fp1.json").exists()
    assert not list((pdftool_home / "tmp").glob("job-*"))


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
