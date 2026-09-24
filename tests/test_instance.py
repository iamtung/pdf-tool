import os
import socket
import subprocess
import sys
import time

import httpx

from pdftool import instance


def test_acquire_is_exclusive_across_processes(pdftool_home):
    lock = instance.acquire()
    try:
        assert lock is not None
        env = dict(os.environ)
        env["PDFTOOL_HOME"] = str(pdftool_home)
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from pdftool import instance; print(instance.acquire())",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert result.stdout.strip() == "None"
    finally:
        lock.close()


def test_write_read_url_round_trip():
    assert instance.read_url() is None
    instance.write_url("http://127.0.0.1:12345")
    assert instance.read_url() == "http://127.0.0.1:12345"


def test_second_launch_reuses_running_servers_url(pdftool_home):
    """A second `pdftool` invocation should print the first instance's URL and
    exit 0, instead of sweeping its live job dirs."""
    env = dict(os.environ)
    env["PDFTOOL_HOME"] = str(pdftool_home)
    proc = subprocess.Popen(
        [sys.executable, "-m", "pdftool.cli", "--no-browser", "--port", "0"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        url = None
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            url = instance.read_url()
            if url:
                break
            time.sleep(0.2)
        assert url, "first instance never wrote server.url"

        healthy = False
        for _ in range(50):
            try:
                if httpx.get(f"{url}/api/system/health", timeout=1).status_code == 200:
                    healthy = True
                    break
            except httpx.TransportError:
                pass
            time.sleep(0.2)
        assert healthy, "first instance never became healthy"

        result = subprocess.run(
            [sys.executable, "-m", "pdftool.cli", "--no-browser"],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert result.returncode == 0
        assert url in result.stdout
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)


def test_taken_port_exits_nonzero_without_writing_url(pdftool_home):
    env = dict(os.environ)
    env["PDFTOOL_HOME"] = str(pdftool_home)

    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker.bind(("127.0.0.1", 0))
    blocker.listen()
    port = blocker.getsockname()[1]
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pdftool.cli", "--no-browser", "--port", str(port)],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert result.returncode == 1
        assert not (pdftool_home / "server.url").exists()
    finally:
        blocker.close()
