import io

import numpy as np
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


def test_multi_placement_keeps_largest(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page()
    photo = make.jpeg_bytes(1200, 1600)
    x = page.insert_image(page.rect, stream=photo)
    page.insert_image(pymupdf.Rect(0, 0, 30, 40), xref=x)
    src = tmp_path / "multi.pdf"
    doc.save(src)
    doc.close()

    with pymupdf.open(src) as d:
        xrefs = {info["xref"] for info in d[0].get_image_info(xrefs=True)}
    assert len(xrefs) == 1  # PyMuPDF dedups identical streams to one xref

    out = tmp_path / "multi_o.pdf"
    compressor.optimize(src, out, [LEVELS["light"]])
    w, _ = image_dims(out, 0)
    assert w == 1200  # full-page placement DPI ~145 < 200 cap, so no downsample


def test_image_shared_with_untouched_page_is_kept(tmp_path):
    doc = pymupdf.open()
    doc.new_page()
    doc.new_page()
    p1, p2 = doc[0], doc[1]
    photo = make.jpeg_bytes(2400, 2400)
    x = p1.insert_image(p1.rect, stream=photo)
    p2.insert_image(p2.rect, xref=x)
    src = tmp_path / "shared.pdf"
    doc.save(src)
    doc.close()

    out = tmp_path / "shared_o.pdf"
    compressor.optimize(src, out, [None, LEVELS["strong"]])
    assert image_dims(out, 0) == image_dims(src, 0)


def test_colour_key_masked_image_is_skipped(tmp_path):
    src = tmp_path / "ck.pdf"
    doc = pymupdf.open()
    doc.new_page()
    doc.save(src)
    doc.close()

    with pikepdf.open(src, allow_overwriting_input=True) as pdf:
        img_bytes = Image.new("RGB", (200, 200), (30, 60, 90)).tobytes()
        img = pdf.make_stream(img_bytes)
        img.Type = pikepdf.Name.XObject
        img.Subtype = pikepdf.Name.Image
        img.Width = 200
        img.Height = 200
        img.BitsPerComponent = 8
        img.ColorSpace = pikepdf.Name.DeviceRGB
        img.Mask = pikepdf.Array([0, 10, 0, 10, 0, 10])
        page = pdf.pages[0]
        page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=img))
        page.Contents = pdf.make_stream(b"q 595 0 0 842 0 0 cm /Im0 Do Q")
        pdf.save(src)

    with pikepdf.open(src) as pdf:
        before = next(iter(pdf.pages[0].images.values()))
        before_width, before_filter = int(before.Width), before.get("/Filter")

    out = tmp_path / "ck_o.pdf"
    rep = compressor.optimize(src, out, [LEVELS["strong"]])
    assert rep.images_skipped == 1 and rep.images_recompressed == 0
    with pikepdf.open(out) as pdf:
        after = next(iter(pdf.pages[0].images.values()))
        assert int(after.Width) == before_width
        assert after.get("/Filter") == before_filter


def test_bad_xref_does_not_crash(mixed):
    report = compressor.CompressReport()
    with pikepdf.open(mixed) as pdf:
        compressor._recompress_one(pdf, 999999, compressor._Target(LEVELS["medium"], 600, False), report)
    assert report.images_skipped == 1


def _build_smask_pdf(path, *, gray_like: bool, matte: bool, w: int = 2400, h: int = 3400):
    import numpy as np

    rng = np.random.default_rng(0)
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(595, 842))
    if gray_like:
        base = rng.integers(0, 255, (h, w, 1), dtype=np.uint8)
        a = np.repeat(base, 3, -1)
    else:
        a = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    mask_kwargs = dict(
        Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image,
        Width=w, Height=h, BitsPerComponent=8, ColorSpace=pikepdf.Name.DeviceGray,
    )
    if matte:
        mask_kwargs["Matte"] = pikepdf.Array([1, 1, 1])
    m = pdf.make_stream(rng.integers(0, 255, (h, w), dtype=np.uint8).tobytes(), **mask_kwargs)
    im = pdf.make_stream(
        a.tobytes(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=w, Height=h,
        BitsPerComponent=8, ColorSpace=pikepdf.Name.DeviceRGB, SMask=m,
    )
    page = pdf.pages[0]
    page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=im))
    page.Contents = pdf.make_stream(b"q 595 0 0 842 0 0 cm /Im0 Do Q")
    pdf.save(path)
    pdf.close()


def test_smask_image_is_compressed_with_matching_mask(tmp_path):
    src = tmp_path / "smask.pdf"
    _build_smask_pdf(src, gray_like=False, matte=False)
    out = tmp_path / "smask_o.pdf"
    rep = compressor.optimize(src, out, [LEVELS["medium"]])
    assert rep.images_recompressed == 1
    with pikepdf.open(out) as pdf:
        im = pdf.pages[0].Resources.XObject.Im0
        sm = im.SMask
        assert (im.Width, im.Height) == (sm.Width, sm.Height)
        assert "/SMask" in im


def test_matte_mask_resized_and_not_grayscaled(tmp_path):
    src = tmp_path / "matte.pdf"
    _build_smask_pdf(src, gray_like=True, matte=True)
    out = tmp_path / "matte_o.pdf"
    rep = compressor.optimize(src, out, [LEVELS["strong"]])
    assert rep.images_recompressed == 1
    with pikepdf.open(out) as pdf:
        im = pdf.pages[0].Resources.XObject.Im0
        sm = im.SMask
        assert (im.Width, im.Height) == (sm.Width, sm.Height)
        assert im.ColorSpace != pikepdf.Name.DeviceGray
        assert len(sm.Matte) == 3


def test_smask_decode_array_not_applied_twice(tmp_path):
    rng = np.random.default_rng(0)
    w, h = 2400, 3400
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(595, 842))
    a = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[:, : w // 2] = 255  # raw 255, but /Decode [1 0] maps it to alpha 0 (transparent)
    mask[:, w // 2 :] = 0    # raw 0 maps to alpha 1 (opaque)
    m = pdf.make_stream(
        mask.tobytes(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image,
        Width=w, Height=h, BitsPerComponent=8, ColorSpace=pikepdf.Name.DeviceGray,
        Decode=pikepdf.Array([1, 0]),
    )
    im = pdf.make_stream(
        a.tobytes(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=w, Height=h,
        BitsPerComponent=8, ColorSpace=pikepdf.Name.DeviceRGB, SMask=m,
    )
    page = pdf.pages[0]
    page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=im))
    page.Contents = pdf.make_stream(b"q 595 0 0 842 0 0 cm /Im0 Do Q")
    src = tmp_path / "dec.pdf"
    pdf.save(src)
    pdf.close()

    out = tmp_path / "dec_o.pdf"
    rep = compressor.optimize(src, out, [LEVELS["medium"]])
    assert rep.images_recompressed == 1
    with pikepdf.open(out) as pdf2:
        sm = pdf2.pages[0].Resources.XObject.Im0.SMask
        assert "/Decode" not in sm  # deleted, so the stored bytes are the final (already-decoded) alpha
        arr = np.asarray(pikepdf.PdfImage(sm).as_pil_image())
        left_mean = arr[:, : arr.shape[1] // 2].mean()
        assert left_mean < 20  # effective alpha stayed ~0, not re-inverted by a stale /Decode
