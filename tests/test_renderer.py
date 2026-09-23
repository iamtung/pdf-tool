import io

from PIL import Image

from pdftool.core import renderer
from pdftool.core.documents import Registry


def _size(data: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(data)).size


def test_thumbnail_width_and_cache(mixed, pdftool_home):
    doc = Registry().open(mixed)
    data = renderer.thumbnail(doc.fitz, doc.fingerprint, 1, 160)
    assert _size(data)[0] == 160
    assert data[:4] == b"RIFF"
    cached = list((pdftool_home / "cache" / "render" / doc.fingerprint).glob("1_w160.webp"))
    assert cached and cached[0].read_bytes() == data


def test_render_clamps_long_side(mixed):
    doc = Registry().open(mixed)
    w, h = _size(renderer.render(doc.fitz, doc.fingerprint, 0, scale=20))
    assert max(w, h) <= renderer.MAX_SIDE


def test_render_blank_and_image_sources(jpg):
    w, h = _size(renderer.render_source({"type": "blank", "width": 595, "height": 842}, 100))
    assert (w, h) == (100, 142)
    w, _ = _size(renderer.render_source({"type": "image", "path": str(jpg)}, 120))
    assert w == 120
