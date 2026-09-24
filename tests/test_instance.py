import os
import subprocess
import sys

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
