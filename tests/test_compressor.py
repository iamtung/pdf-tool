import io

import pikepdf
import pymupdf
import pytest
from PIL import Image

from pdftool.core import compressor
from pdftool.core.plan import LEVELS, ImageSettings
from tests.fixtures import make
from tests.imaging import gray_page, ssim


def image_dims(path, page):
    with pymupdf.open(path) as d:
        info = d[page].get_image_info()[0]
        return info["width"], info["height"]


def test_medium_shrinks_and_keeps_text(mixed, tmp_path):
    out = tmp_path / "out.pdf"
    rep = compressor.optimize(mixed, out, [LEVELS["medium"]] * 5)
    assert out.stat().st_size < mixed.stat().st_size * 0.3
    assert rep.images_recompressed >= 2
    with pymupdf.open(out) as d:
        assert "Hello vector text page" in d[1].get_text()
        assert d.page_count == 5
    w, _ = image_dims(out, 0)
    assert 1200 <= w <= 1260  # 595pt @150dpi ~ 1240px


def test_light_quality_ssim(mixed, tmp_path):
    out = tmp_path / "out.pdf"
    compressor.optimize(mixed, out, [LEVELS["light"]] * 5)
    for page in (0, 2):
        assert ssim(gray_page(mixed, page), gray_page(out, page)) >= 0.95


def test_none_settings_leave_page_untouched(mixed, tmp_path):
    out = tmp_path / "out.pdf"
    compressor.optimize(mixed, out, [None, None, LEVELS["strong"], None, None])
    assert image_dims(out, 0) == image_dims(mixed, 0)  # scan page untouched


def test_shared_image_uses_lightest_level(mixed, tmp_path):
    out = tmp_path / "out.pdf"
    compressor.optimize(mixed, out, [None, None, LEVELS["strong"], LEVELS["light"], None])
    w, _ = image_dims(out, 2)
    assert w > 1300  # light (200dpi cap) rather than strong (100dpi)


def test_strong_grayscales_near_gray_scan(mixed, tmp_path):
    out = tmp_path / "out.pdf"
    compressor.optimize(mixed, out, [LEVELS["strong"]] + [None] * 4)
    with pikepdf.open(out) as pdf:
        img = next(iter(pdf.pages[0].images.values()))
        assert img.ColorSpace == "/DeviceGray"


def test_already_small_image_is_kept(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page()
    # flat-colour PNG is stored as a tiny Flate stream; JPEG would be bigger
    buf = io.BytesIO()
    Image.new("RGB", (100, 100), "red").save(buf, "PNG")
    page.insert_image(pymupdf.Rect(0, 0, 100, 100), stream=buf.getvalue())
    src = tmp_path / "small.pdf"
    doc.save(src, deflate=True)
    rep = compressor.optimize(src, tmp_path / "o.pdf", [LEVELS["strong"]])
    assert rep.images_recompressed == 0 and rep.images_skipped == 1


def test_near_gray_detection():
    assert compressor.is_near_gray(Image.new("RGB", (50, 50), (120, 121, 119)))
    assert not compressor.is_near_gray(Image.new("RGB", (50, 50), (200, 30, 30)))


@pytest.mark.skipif(not compressor.ghostscript_available(), reason="ghostscript not installed")
def test_ghostscript_screen(mixed, tmp_path):
    out = tmp_path / "gs.pdf"
    compressor.ghostscript(mixed, out)
    assert out.stat().st_size < mixed.stat().st_size * 0.1
    with pymupdf.open(out) as d:
        assert d.page_count == 5


@pytest.mark.skipif(not compressor.ghostscript_available(), reason="ghostscript not installed")
def test_ghostscript_custom_settings(mixed, tmp_path):
    out = tmp_path / "gs.pdf"
    compressor.ghostscript(mixed, out, ImageSettings(100, 60))
    assert out.stat().st_size < mixed.stat().st_size * 0.2
