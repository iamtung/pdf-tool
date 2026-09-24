"""Single-instance lock so a second server's startup sweep can't delete a running
instance's live job dirs (spec §7/§10)."""
import fcntl

from pdftool import paths

LOCK_NAME = "server.lock"
URL_NAME = "server.url"


def acquire():
    """Try to become the sole running instance.

    Returns the open lock file object (keep it open for the process lifetime to
    hold the lock) if acquired, or None if another instance already holds it.
    """
    path = paths.home() / LOCK_NAME
    fd = open(path, "a+")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fd.close()
        return None
    return fd


def write_url(url: str) -> None:
    (paths.home() / URL_NAME).write_text(url)


def read_url() -> str | None:
    path = paths.home() / URL_NAME
    if not path.exists():
        return None
    text = path.read_text().strip()
    return text or None
