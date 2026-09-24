"""Spec §8 criteria. Slow: run with `uv run pytest -m slow`."""
import subprocess
import sys
import time

import httpx

import pymupdf
import pytest
from fastapi.testclient import TestClient

from pdftool.server import create_app
from tests.fixtures import make

pytestmark = pytest.mark.slow

BASE = "http://127.0.0.1"  # LocalGuardMiddleware rejects TestClient's default "testserver" Host


@pytest.fixture(scope="module")
def big_pdf(tmp_path_factory):
    """~500 MB: distinct 600 DPI scans (each ~15 MB)."""
    path = tmp_path_factory.mktemp("big") / "big.pdf"
    doc = pymupdf.open()
    for i in range(34):
        make.add_scan_page(doc, dpi=600, seed=i)
    doc.save(path)
    assert path.stat().st_size > 450_000_000
    return path


def test_open_and_first_page_under_3s(big_pdf):
    with TestClient(create_app(), base_url=BASE) as client:
        t = time.perf_counter()
        doc = client.post("/api/docs/open", json={"path": str(big_pdf)}).json()
        r = client.get(f"/api/docs/{doc['docId']}/pages/0/thumb")
        assert r.status_code == 200
        assert time.perf_counter() - t <= 3.0


def test_backend_memory_stays_under_1gb(big_pdf):
    """Measure the real server process (the test process holds the fixture in memory)."""
    port = 8791
    proc = subprocess.Popen([sys.executable, "-m", "pdftool.cli", "--no-browser", "--port", str(port)])
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(50):
            try:
                httpx.get(f"{base}/api/system/health")
                break
            except httpx.ConnectError:
                time.sleep(0.2)
        doc = httpx.post(f"{base}/api/docs/open", json={"path": str(big_pdf)}).json()
        for i in range(0, 34, 3):
            assert httpx.get(f"{base}/api/docs/{doc['docId']}/pages/{i}/render?scale=1.5", timeout=30).status_code == 200
        rss_kb = int(subprocess.run(["ps", "-o", "rss=", "-p", str(proc.pid)], capture_output=True, text=True).stdout)
        assert rss_kb * 1024 < 1024**3
    finally:
        proc.terminate()
        proc.wait(timeout=10)
