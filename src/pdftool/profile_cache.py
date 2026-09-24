"""Compression profiles cached on disk by document fingerprint (same pattern as analysis_cache)."""
import json
import os
from pathlib import Path

from pdftool import paths
from pdftool.core.profile import PROFILE_VERSION


def _file(fp: str) -> Path:
    d = paths.cache_dir() / "profile"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{fp}.json"


def load(fp: str) -> dict | None:
    f = _file(fp)
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    # A profile from another algorithm version is treated as missing.
    if not isinstance(data, dict) or data.get("version") != PROFILE_VERSION:
        return None
    return data


def save(fp: str, profile: dict) -> None:
    f = _file(fp)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(profile))
    os.replace(tmp, f)
