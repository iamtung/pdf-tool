import os
import time

from pdftool import housekeeping, paths


def _age(p, days):
    t = time.time() - days * 86400
    os.utime(p, (t, t))


def test_removes_old_uploads_and_tmp():
    old, new = paths.uploads_dir() / "old", paths.tmp_dir() / "new.pdf"
    old.mkdir()
    new.write_bytes(b"x")
    _age(old, 8)
    housekeeping.cleanup()
    assert not old.exists() and new.exists()


def test_cache_limit_drops_oldest():
    a, b = paths.cache_dir() / "a.webp", paths.cache_dir() / "b.webp"
    a.write_bytes(b"x" * 100)
    b.write_bytes(b"x" * 100)
    _age(a, 1)
    housekeeping.cleanup(cache_limit=150)
    assert not a.exists() and b.exists()
