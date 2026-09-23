import os
from pathlib import Path


def home() -> Path:
    """Root data dir. Override with PDFTOOL_HOME (used by tests)."""
    root = Path(os.environ.get("PDFTOOL_HOME", Path.home() / ".pdftool"))
    for sub in ("cache", "uploads", "tmp"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def cache_dir() -> Path:
    return home() / "cache"


def uploads_dir() -> Path:
    return home() / "uploads"


def tmp_dir() -> Path:
    return home() / "tmp"
