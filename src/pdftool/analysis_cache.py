"""Analysis reports cached on disk by document fingerprint."""
import json
import os
from pathlib import Path

from pdftool import paths


def _file(fp: str) -> Path:
    d = paths.cache_dir() / "analysis"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{fp}.json"


def load(fp: str) -> dict | None:
    f = _file(fp)
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def save(fp: str, report: dict) -> None:
    f = _file(fp)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(report))
    os.replace(tmp, f)
