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
            try:
                if _age_days(entry) > max_age_days:
                    shutil.rmtree(entry, ignore_errors=True) if entry.is_dir() else entry.unlink(missing_ok=True)
            except (FileNotFoundError, OSError):
                pass  # another process (or a previous pass) already removed it

    entries = []
    for f in paths.cache_dir().rglob("*"):
        try:
            if f.is_file():
                entries.append((f, f.stat().st_mtime, f.stat().st_size))
        except (FileNotFoundError, OSError):
            continue  # vanished mid-scan
    entries.sort(key=lambda e: e[1])
    total = sum(size for _, _, size in entries)
    for f, _mtime, size in entries:
        if total <= cache_limit:
            break
        total -= size
        try:
            f.unlink(missing_ok=True)
        except OSError:
            pass
