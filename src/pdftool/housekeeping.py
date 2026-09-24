"""Startup cleanup: stale uploads/tmp and cache size cap (spec §7)."""
import shutil
import time
from pathlib import Path

from pdftool import paths

MAX_AGE_DAYS = 7
CACHE_LIMIT = 2 * 1024**3


def _age_days(p: Path) -> float:
    return (time.time() - p.stat().st_mtime) / 86400


def cleanup(max_age_days: float = MAX_AGE_DAYS, cache_limit: int = CACHE_LIMIT) -> None:
    for root in (paths.uploads_dir(), paths.tmp_dir()):
        for entry in root.iterdir():
            if _age_days(entry) > max_age_days:
                shutil.rmtree(entry, ignore_errors=True) if entry.is_dir() else entry.unlink(missing_ok=True)
    files = sorted((f for f in paths.cache_dir().rglob("*") if f.is_file()), key=lambda f: f.stat().st_mtime)
    total = sum(f.stat().st_size for f in files)
    for f in files:
        if total <= cache_limit:
            break
        total -= f.stat().st_size
        f.unlink(missing_ok=True)
