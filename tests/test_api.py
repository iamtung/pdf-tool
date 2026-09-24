import json
import os
import time

import pytest
from fastapi.testclient import TestClient

from pdftool.server import create_app


BASE = "http://127.0.0.1"


@pytest.fixture
def client():
    with TestClient(create_app(), base_url=BASE) as c:
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


def test_profile_endpoint_running_then_done(client, vector3, pdftool_home):
    doc = open_doc(client, vector3)
    r = client.get(f"/api/docs/{doc['docId']}/profile")
    assert r.status_code == 202 and r.json()["status"] == "running"
    job = wait_job(client, r.json()["jobId"])
    assert job["status"] == "done", job["error"]
    r = client.get(f"/api/docs/{doc['docId']}/profile")
    assert r.status_code == 200 and r.json()["status"] == "done"
    prof = r.json()["profile"]
    assert prof["version"] == 1 and prof["pageCount"] == 3
    assert set(prof["ratios"]) == {"vector"}
    assert list((pdftool_home / "cache" / "analysis").glob("*.json"))
    assert list((pdftool_home / "cache" / "profile").glob("*.json"))


def test_profile_cached_second_call_is_200(client, vector3):
    doc = open_doc(client, vector3)
    wait_job(client, client.get(f"/api/docs/{doc['docId']}/profile").json()["jobId"])
    r1 = client.get(f"/api/docs/{doc['docId']}/profile")
    r2 = client.get(f"/api/docs/{doc['docId']}/profile")
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["profile"] == r2.json()["profile"]


def test_profile_version_mismatch_recomputes(client, vector3, pdftool_home):
    doc = open_doc(client, vector3)
    wait_job(client, client.get(f"/api/docs/{doc['docId']}/profile").json()["jobId"])
    cache = next((pdftool_home / "cache" / "profile").glob("*.json"))
    data = json.loads(cache.read_text())
    data["version"] = 999
    cache.write_text(json.dumps(data))
    r = client.get(f"/api/docs/{doc['docId']}/profile")
    assert r.status_code == 202 and r.json()["status"] == "running"
    job = wait_job(client, r.json()["jobId"])
    assert job["status"] == "done", job["error"]
    r = client.get(f"/api/docs/{doc['docId']}/profile")
    assert r.status_code == 200 and r.json()["profile"]["version"] == 1
    assert json.loads(cache.read_text())["version"] == 1


def test_profile_dedup_same_job_id(client, mixed):
    doc = open_doc(client, mixed)
    r1 = client.get(f"/api/docs/{doc['docId']}/profile")
    r2 = client.get(f"/api/docs/{doc['docId']}/profile")
    assert r1.status_code == 202 and r2.status_code == 202
    assert r1.json()["jobId"] == r2.json()["jobId"]


def test_profile_unknown_doc_404(client):
    r = client.get("/api/docs/nope/profile")
    assert r.status_code == 404 and r.json()["code"] == "not_found"


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


# --- hardening (host/origin checks, traversal, error shape) ---

def test_spa_path_traversal_serves_index(tmp_path, monkeypatch):
    from pdftool import server
    static = tmp_path / "web" / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html>spa</html>")
    (static / "favicon.ico").write_text("icon")
    (tmp_path / "secret.txt").write_text("TOP-SECRET")
    monkeypatch.setattr(server, "STATIC", static)
    with TestClient(server.create_app(), base_url=BASE) as c:
        for url in ("/%2e%2e/%2e%2e/secret.txt", "/%2e%2e%2f%2e%2e%2fsecret.txt", "/..%2f..%2fsecret.txt"):
            r = c.get(url)
            assert "TOP-SECRET" not in r.text, url
            assert r.status_code == 200 and r.text == "<html>spa</html>", url
        assert c.get("/favicon.ico").text == "icon"
        assert c.get("/some/client/route").text == "<html>spa</html>"
        r = c.get("/api/nope")
        assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_unknown_api_route_is_json_404(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.json()["code"] == "not_found"
    r = client.post("/api/nope", json={})
    assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_foreign_host_rejected(client):
    r = client.get("/api/system/health", headers={"host": "evil.example"})
    assert r.status_code == 400 and r.json()["code"] == "bad_request"
    r = client.get("/api/system/health", headers={"host": "localhost:5173"})
    assert r.status_code == 200


@pytest.mark.parametrize("origin,status", [
    ("http://evil.example", 403),
    ("null", 403),
    ("http://127.0.0.1", 404),          # same origin as Host -> passes to the endpoint
    ("http://localhost:5173", 403),     # Vite dev server: only trusted with PDFTOOL_DEV=1
])
def test_origin_check(client, tmp_path, origin, status):
    r = client.post("/api/docs/open", json={"path": str(tmp_path / "x.pdf")}, headers={"Origin": origin})
    assert r.status_code == status
    assert r.json()["code"] == ("forbidden" if status == 403 else "not_found")


def test_cross_origin_upload_and_bodyless_post_rejected(client):
    r = client.post("/api/docs/upload", files={"file": ("x.pdf", b"%PDF", "application/pdf")},
                    headers={"Origin": "http://evil.example"})
    assert r.status_code == 403 and r.json()["code"] == "forbidden"
    r = client.post("/api/system/pick-folder", headers={"Origin": "http://evil.example"})
    assert r.status_code == 403


def test_non_json_body_rejected(client, tmp_path):
    body = json.dumps({"path": str(tmp_path / "x.pdf")})
    r = client.post("/api/docs/open", content=body, headers={"Content-Type": "text/plain"})
    assert r.status_code in (400, 415) and r.json()["code"] == "bad_request"
    r = client.post("/api/docs/upload", content=b"x", headers={"Content-Type": "text/plain"})
    assert r.status_code in (400, 415) and r.json()["code"] == "bad_request"


def test_validation_error_shape(client):
    r = client.post("/api/docs/open", json={})
    assert r.status_code == 400
    body = r.json()
    assert body["code"] == "bad_request" and "path" in body["message"] and "detail" not in body


def test_unexpected_error_is_generic_500(client, monkeypatch):
    from pdftool.api import system

    def boom():
        raise RuntimeError("secret internals")
    monkeypatch.setattr(system.macos, "pick_folder", boom)
    with TestClient(client.app, base_url=BASE, raise_server_exceptions=False) as c:
        r = c.post("/api/system/pick-folder")
    assert r.status_code == 500
    assert r.json() == {"code": "internal", "message": "Lỗi không mong muốn."}


def test_render_non_image_is_bad_request(client, tmp_path):
    f = tmp_path / "notes.txt"
    f.write_text("not an image")
    r = client.post("/api/render", json={"source": {"type": "image", "path": str(f)}})
    assert r.status_code == 400 and r.json()["code"] == "bad_request"


def test_render_width_limited(client):
    r = client.post("/api/render", json={"source": {"type": "blank", "width": 1, "height": 1}, "width": 20000})
    assert r.status_code == 400 and r.json()["code"] == "bad_request"
    r = client.post("/api/render", json={"source": {"type": "blank", "width": 1, "height": 100000}, "width": 800})
    assert r.status_code == 200


@pytest.mark.parametrize("name", ["..", ".", "  "])  # "" is sent as a non-file field -> 400
def test_upload_bad_names_fall_back(client, name):
    r = client.post("/api/docs/upload", files={"file": (name, b"%PDF-1.4", "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["path"].endswith("/upload.pdf")


def test_export_sanitises_base_name(client, vector3):
    doc = open_doc(client, vector3)
    r = client.post("/api/export", json={"plan": plan(doc["docId"], 1), "baseName": "Q1/Q2 report"})
    job = wait_job(client, r.json()["jobId"])
    assert job["status"] == "done", job["error"]
    assert job["result"]["outputs"][0]["path"] == str(vector3.parent / "Q1_Q2 report_edited.pdf")


def test_export_base_name_only_dots_uses_default(client, vector3):
    doc = open_doc(client, vector3)
    r = client.post("/api/export", json={"plan": plan(doc["docId"], 1), "baseName": " ../.."})
    job = wait_job(client, r.json()["jobId"])
    assert job["status"] == "done", job["error"]
    out = job["result"]["outputs"][0]["path"]
    assert out.startswith(str(vector3.parent) + "/") and "/.." not in out


def test_closed_doc_is_not_found(client, vector3):
    doc = open_doc(client, vector3)
    stale = client.app.state.registry.get(doc["docId"])
    assert client.delete(f"/api/docs/{doc['docId']}").json() == {"ok": True}
    r = client.get(f"/api/docs/{doc['docId']}/pages/0/thumb")
    assert r.status_code == 404 and r.json()["code"] == "not_found"
    # a request that fetched the Document before close must not touch the closed fitz doc
    from pdftool.core.errors import PdfToolError
    with pytest.raises(PdfToolError) as e:
        with stale.use():
            pass
    assert e.value.code == "not_found"


def test_job_marked_failed_when_process_cannot_start(client, monkeypatch):
    import multiprocessing.process
    monkeypatch.setattr(multiprocessing.process.BaseProcess, "start",
                        lambda self: (_ for _ in ()).throw(OSError("EAGAIN")))
    r = client.post("/api/estimate", json={"plan": {"pages": [
        {"id": "b", "source": {"type": "blank", "width": 595, "height": 842}}]}})
    job = wait_job(client, r.json()["jobId"], timeout=10)
    assert job["status"] == "failed" and job["error"]["code"] == "internal"


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_dev_origins_need_env(tmp_path, monkeypatch, origin):
    body = {"path": str(tmp_path / "x.pdf")}
    monkeypatch.delenv("PDFTOOL_DEV", raising=False)
    with TestClient(create_app(), base_url=BASE) as c:
        r = c.post("/api/docs/open", json=body, headers={"Origin": origin})
        assert r.status_code == 403 and r.json()["code"] == "forbidden"
    monkeypatch.setenv("PDFTOOL_DEV", "1")
    with TestClient(create_app(), base_url=BASE) as c:
        r = c.post("/api/docs/open", json=body, headers={"Origin": origin})
        assert r.status_code == 404 and r.json()["code"] == "not_found"


@pytest.mark.parametrize("site,status", [
    ("cross-site", 403), ("same-origin", 200), ("same-site", 200), ("none", 200), (None, 200),
])
def test_sec_fetch_site(client, site, status):
    headers = {"Sec-Fetch-Site": site} if site else {}
    r = client.get("/api/system/health", headers=headers)
    assert r.status_code == status
    if status == 403:
        assert r.json()["code"] == "forbidden"
        r = client.post("/api/system/pick-folder", headers=headers)
        assert r.status_code == 403


LONG_VN = "Báo cáo tài chính quý một năm hai nghìn " * 8  # ~300 chars, multibyte


def test_upload_long_name_truncated(client):
    name = LONG_VN[:300] + ".pdf"
    assert len(name.encode()) > 300
    r = client.post("/api/docs/upload", files={"file": (name, b"%PDF-1.4", "application/pdf")})
    assert r.status_code == 200, r.text
    saved = r.json()["path"].rsplit("/", 1)[1]
    assert len(saved.encode()) <= 200 and saved.endswith(".pdf")
    assert name.startswith(saved[:-4])  # a clean prefix: no split character


def test_export_long_base_name_truncated(client, vector3):
    doc = open_doc(client, vector3)
    r = client.post("/api/export", json={"plan": plan(doc["docId"], 1), "baseName": LONG_VN[:300]})
    job = wait_job(client, r.json()["jobId"])
    assert job["status"] == "done", job["error"]
    out = job["result"]["outputs"][0]["path"]
    stem = out.rsplit("/", 1)[1].removesuffix("_edited.pdf")
    assert len(stem.encode()) <= 200 and LONG_VN.startswith(stem)


@pytest.mark.parametrize("split", [
    {"mode": "pages"},
    {"mode": "size"},
    {"mode": "size", "maxMB": 0},
    {"mode": "size", "maxMB": -1},
    {"mode": "size", "maxMB": "abc"},
    {"mode": "ranges"},
    "1-2",
])
def test_export_bad_split_rejected_immediately(client, vector3, split):
    doc = open_doc(client, vector3)
    r = client.post("/api/export", json={"plan": plan(doc["docId"], 2), "split": split})
    assert r.status_code == 400 and r.json()["code"] == "bad_request"


def test_export_split_ranges_via_api(client, vector3):
    doc = open_doc(client, vector3)
    r = client.post("/api/export", json={"plan": plan(doc["docId"], 3), "split": {"mode": "ranges", "ranges": "1,2-3"}})
    job = wait_job(client, r.json()["jobId"])
    assert job["status"] == "done", job["error"]
    assert len(job["result"]["outputs"]) == 2
