"""Test-only worker tasks, addressed as ``"tests.helpers:<name>"`` job kinds."""
import subprocess
import time
from pathlib import Path


def spawn_sleeper(args: dict, progress) -> dict:
    """Start a long-lived child process, record its pid, then idle until killed."""
    child = subprocess.Popen(["sleep", "60"])
    pid_file = Path(args["pidFile"])
    tmp = pid_file.with_suffix(".tmp")
    tmp.write_text(str(child.pid))
    tmp.replace(pid_file)
    progress(0.1, "sleeping")
    time.sleep(60)
    return {}


def quick(args: dict, progress) -> dict:
    time.sleep(args.get("delay", 0))
    if args.get("marker"):
        Path(args["marker"]).write_text("ran")
    return {"ok": True}


def big_result(args: dict, progress) -> dict:
    size = args.get("size", 5_000_000)
    progress(0.5, "building")
    return {"blob": "x" * size, "items": list(range(10_000))}


def boom(args: dict, progress) -> dict:
    raise RuntimeError("kaboom")
