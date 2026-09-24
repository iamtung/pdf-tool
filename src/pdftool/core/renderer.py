"""Thumbnails and large page renders as WebP, cached on disk (spec §4.3)."""
import os
import threading
from pathlib import Path

import pymupdf
from PIL import Image

from pdftool import paths

MAX_SIDE = 4000
WEBP_QUALITY = 80


def _cache_file(fp: str, index: int, key: str) -> Path:
    d = paths.cache_dir() / "render" / fp
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{index}_{key}.webp"


def _write_atomic(path: Path, data: bytes) -> None:
    # Thread-unique tmp name: two concurrent requests for the same page must not clobber each
    # other's tmp file before the os.replace (previously keyed only by pid).
    tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _to_webp(pix: pymupdf.Pixmap) -> bytes:
    return pix.pil_tobytes(format="WEBP", quality=WEBP_QUALITY)


def _clamp_scale(page: pymupdf.Page, scale: float) -> float:
    longest = max(page.rect.width, page.rect.height) * scale
    return scale if longest <= MAX_SIDE else MAX_SIDE / max(page.rect.width, page.rect.height)


def thumbnail(fdoc: pymupdf.Document, fp: str, index: int, width: int = 160) -> bytes:
    width = max(32, min(width, 800))
    cached = _cache_file(fp, index, f"w{width}")
    if cached.exists():
        return cached.read_bytes()
    page = fdoc[index]
    scale = width / page.rect.width if page.rotation % 180 == 0 else width / page.rect.height
    data = _to_webp(page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False))
    _write_atomic(cached, data)
    return data


def render(fdoc: pymupdf.Document, fp: str, index: int, scale: float = 1.5) -> bytes:
    page = fdoc[index]
    scale = _clamp_scale(page, max(0.1, scale))
    cached = _cache_file(fp, index, f"s{scale:.3f}")
    if cached.exists():
        return cached.read_bytes()
    data = _to_webp(page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False))
    _write_atomic(cached, data)
    return data


def render_source(source: dict, width: int = 160) -> bytes:
    """Render a non-PDF plan page (blank or image) at the given width."""
    if source["type"] == "blank":
        w, h = source["width"], source["height"]
        img = Image.new("RGB", (width, min(width * 4, max(1, round(width * h / w)))), "white")
    elif source["type"] == "image":
        img = Image.open(source["path"]).convert("RGB")
        img.thumbnail((width, width * 4))
    else:
        raise ValueError(f"unsupported source type {source['type']}")
    from io import BytesIO

    buf = BytesIO()
    img.save(buf, "WEBP", quality=WEBP_QUALITY)
    return buf.getvalue()
