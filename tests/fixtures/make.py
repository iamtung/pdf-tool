"""Synthetic PDF fixtures. Images are gradients + noise so JPEG can't cheat."""
import io
from pathlib import Path

import numpy as np
import pikepdf
import pymupdf
from PIL import Image

A4 = (595, 842)


def jpeg_bytes(w: int, h: int, *, gray: bool = False, seed: int = 0, quality: int = 95) -> bytes:
    rng = np.random.default_rng(seed)
    ramp = np.linspace(0, 255, w, dtype=np.float32)[None, :].repeat(h, 0)
    if gray:
        arr = np.stack([ramp] * 3, -1)
    else:
        arr = np.stack([ramp, ramp[:, ::-1], np.full_like(ramp, 128)], -1)
    arr = (arr + rng.integers(0, 40, arr.shape)).clip(0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def png_bytes(w: int, h: int, seed: int = 1) -> bytes:
    rng = np.random.default_rng(seed)
    arr = rng.integers(0, 255, (h, w, 3)).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG")
    return buf.getvalue()


def add_scan_page(doc: pymupdf.Document, dpi: int = 600, seed: int = 0) -> None:
    page = doc.new_page(width=A4[0], height=A4[1])
    w, h = int(A4[0] / 72 * dpi), int(A4[1] / 72 * dpi)
    page.insert_image(page.rect, stream=jpeg_bytes(w, h, gray=True, seed=seed))


def add_vector_page(doc: pymupdf.Document, text: str = "Vector page") -> None:
    page = doc.new_page(width=A4[0], height=A4[1])
    page.insert_text((72, 72), text, fontsize=14)
    page.draw_rect(pymupdf.Rect(72, 100, 300, 200), color=(0, 0, 1))


def add_image_page(doc: pymupdf.Document, image: bytes, text: str = "Photo page") -> None:
    page = doc.new_page(width=A4[0], height=A4[1])
    page.insert_text((72, 60), text, fontsize=12)
    page.insert_image(pymupdf.Rect(50, 100, 545, 430), stream=image)


def mixed_pdf(path: Path) -> Path:
    """p0 scan 600dpi | p1 vector | p2,p3 share one photo | p4 vector"""
    doc = pymupdf.open()
    add_scan_page(doc)
    add_vector_page(doc, "Hello vector text page")
    photo = jpeg_bytes(3000, 2000, seed=7)
    add_image_page(doc, photo, "Shared 0")
    add_image_page(doc, photo, "Shared 1")
    add_vector_page(doc, "Last page")
    doc.save(path, garbage=3, deflate=True)
    return path


def vector_pdf(path: Path, pages: int = 3) -> Path:
    doc = pymupdf.open()
    for i in range(pages):
        add_vector_page(doc, f"Page {i + 1}")
    doc.save(path)
    return path


def scans_pdf(path: Path, pages: int = 4, dpi: int = 600) -> Path:
    doc = pymupdf.open()
    for i in range(pages):
        add_scan_page(doc, dpi=dpi, seed=i)
    doc.save(path)
    return path


def encrypted_pdf(path: Path, password: str = "secret") -> Path:
    src = path.with_suffix(".plain.pdf")
    vector_pdf(src, 2)
    with pikepdf.open(src) as pdf:
        pdf.save(path, encryption=pikepdf.Encryption(user=password, owner=password))
    return path


def corrupted_pdf(path: Path) -> Path:
    path.write_bytes(b"%PDF-1.7\nthis is not really a pdf\n%%EOF")
    return path


def image_file(path: Path, w: int = 600, h: int = 400) -> Path:
    path.write_bytes(jpeg_bytes(w, h, seed=3))
    return path


PAGE_PT = (144, 180)  # small pages keep the fixtures (and every optimize pass) cheap


def image_pages_pdf(path: Path, pixel_sizes, title=None) -> Path:
    """One full-page JPEG per page, each with its own /Resources. DPI = pixels / 2 in."""
    pdf = pikepdf.new()
    for k, (w, h) in enumerate(pixel_sizes):
        img = pikepdf.Stream(
            pdf, jpeg_bytes(w, h, seed=k), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image,
            Width=w, Height=h, ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8,
            Filter=pikepdf.Name.DCTDecode,
        )
        content = pikepdf.Stream(pdf, f"q {PAGE_PT[0]} 0 0 {PAGE_PT[1]} 0 0 cm /Im0 Do Q".encode())
        pdf.pages.append(pikepdf.Page(pikepdf.Dictionary(
            Type=pikepdf.Name.Page, MediaBox=[0, 0, *PAGE_PT], Contents=content,
            Resources=pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=img)),
        )))
    if title:
        pdf.docinfo["/Title"] = title
        with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
            meta["dc:title"] = title
    pdf.save(path)
    return path


HEAVY, LIGHT = (1200, 1500), (240, 300)  # 600 DPI and 120 DPI on a 2 x 2.5 in page
