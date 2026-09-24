import json
import os
import time

import pytest
from fastapi.testclient import TestClient

from pdftool.server import create_app


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


def open_doc(client, path, password=None):
    r = client.post("/api/docs/open", json={"path": str(path), "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def wait_job(client, job_id, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.1)
    raise AssertionError("job timeout")


def plan(doc_id, n, **extra):
    return {"pages": [{"id": f"p{i}", "source": {"type": "pdf", "docId": doc_id, "index": i}} for i in range(n)], **extra}


def test_open_returns_overview(client, mixed):
    info = open_doc(client, mixed)
    assert info["pageCount"] == 5 and info["name"] == "mixed.pdf"
    assert len(info["pages"]) == 5


@pytest.mark.parametrize("fixture,password,code,status", [
    ("encrypted", None, "password_required", 401),
    ("encrypted", "nope", "wrong_password", 403),
    ("corrupted", None, "corrupted", 422),
])
def test_open_errors(client, request, fixture, password, code, status):
    path = request.getfixturevalue(fixture)
    r = client.post("/api/docs/open", json={"path": str(path), "password": password})
    assert r.status_code == status
    assert r.json()["code"] == code


def test_not_found(client, tmp_path):
    r = client.post("/api/docs/open", json={"path": str(tmp_path / "x.pdf")})
    assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_file_changed(client, vector3):
    doc = open_doc(client, vector3)
    st = vector3.stat()
    os.utime(vector3, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    r = client.get(f"/api/docs/{doc['docId']}/pages/0/thumb")
    assert r.status_code == 409 and r.json()["code"] == "file_changed"


def test_analysis_sync_and_cached(client, mixed):
    doc = open_doc(client, mixed)
    r = client.get(f"/api/docs/{doc['docId']}/analysis")
    assert r.status_code == 200 and r.json()["status"] == "done"
    assert r.json()["report"]["kinds"]["scan"] == 1


def test_analysis_background_for_big_docs(client, mixed, monkeypatch):
    from pdftool.api import docs
    monkeypatch.setattr(docs, "SYNC_ANALYSIS_MAX_BYTES", 10)
    doc = open_doc(client, mixed)
    r = client.get(f"/api/docs/{doc['docId']}/analysis")
    assert r.status_code == 202
    assert wait_job(client, r.json()["jobId"])["status"] == "done"
    r = client.get(f"/api/docs/{doc['docId']}/analysis")
    assert r.status_code == 200 and r.json()["status"] == "done"


def test_thumb_and_render(client, mixed):
    doc = open_doc(client, mixed)
    r = client.get(f"/api/docs/{doc['docId']}/pages/1/thumb?w=120")
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert client.get(f"/api/docs/{doc['docId']}/pages/1/render?scale=1").status_code == 200
    assert client.get(f"/api/docs/{doc['docId']}/pages/9/thumb").status_code == 404


def test_render_blank(client):
    r = client.post("/api/render", json={"source": {"type": "blank", "width": 595, "height": 842}, "width": 80})
    assert r.status_code == 200


def test_upload_then_open(client, vector3):
    with open(vector3, "rb") as f:
        r = client.post("/api/docs/upload", files={"file": ("my file.pdf", f, "application/pdf")})
    path = r.json()["path"]
    assert path.endswith("my file.pdf")
    assert open_doc(client, path)["uploaded"] is True


def test_estimate_page_scope(client, mixed):
    doc = open_doc(client, mixed)
    r = client.post("/api/estimate", json={"plan": plan(doc["docId"], 5), "pageIds": ["p0"], "level": "medium"})
    job = wait_job(client, r.json()["jobId"])
    assert job["status"] == "done", job["error"]
    assert job["result"]["estimatedBytes"] < job["result"]["originalBytes"]


def test_estimate_requires_level_for_pages(client, mixed):
    doc = open_doc(client, mixed)
    r = client.post("/api/estimate", json={"plan": plan(doc["docId"], 5), "pageIds": ["p0"]})
    assert r.status_code == 400


def test_estimate_empty_plan_rejected(client):
    r = client.post("/api/estimate", json={"plan": {"pages": []}})
    assert r.status_code == 400 and r.json()["code"] == "bad_request"


def test_export_writes_next_to_source(client, vector3):
    doc = open_doc(client, vector3)
    r = client.post("/api/export", json={"plan": plan(doc["docId"], 2)})
    job = wait_job(client, r.json()["jobId"])
    assert job["status"] == "done", job["error"]
    out = job["result"]["outputs"][0]
    assert out["path"] == str(vector3.parent / "vector_edited.pdf")


def test_export_empty_plan_rejected(client):
    r = client.post("/api/export", json={"plan": {"pages": []}})
    assert r.status_code == 400 and r.json()["code"] == "bad_request"


def test_sse_streams_until_done(client, vector3):
    doc = open_doc(client, vector3)
    job_id = client.post("/api/export", json={"plan": plan(doc["docId"], 1)}).json()["jobId"]
    events = []
    with client.stream("GET", f"/api/jobs/{job_id}/events") as r:
        for line in r.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    assert events[-1]["status"] == "done"


def test_cancel_job(client, scans):
    doc = open_doc(client, scans)
    job_id = client.post("/api/export", json={"plan": plan(doc["docId"], 4, fileCompression={"targetMB": 0.01})}).json()["jobId"]
    time.sleep(0.3)
    assert client.delete(f"/api/jobs/{job_id}").json()["status"] == "cancelled"


def test_health(client):
    h = client.get("/api/system/health").json()
    assert set(h) >= {"ghostscript", "freeBytes"}


def test_pick_file_uses_macos(client, monkeypatch):
    from pdftool import macos
    monkeypatch.setattr(macos, "pick_files", lambda kind, multiple: ["/tmp/a.pdf"])
    assert client.post("/api/system/pick-file", json={"kind": "pdf"}).json() == {"paths": ["/tmp/a.pdf"]}
