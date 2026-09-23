"""Low-level page inspection shared by analyzer and compressor."""
import math
from dataclasses import dataclass

import pikepdf
import pymupdf

SCAN_COVERAGE = 0.85
SCAN_MAX_TEXT_CHARS = 50


@dataclass
class Placement:
    xref: int
    width: int      # pixels
    height: int
    dpi: float      # effective DPI on the page
    coverage: float  # fraction of page area covered by the image
    bbox: tuple[float, float, float, float] = (0, 0, 0, 0)  # unrotated page coords, points


def placements(page: pymupdf.Page) -> list[Placement]:
    """Image placements on a page (skips inline images, xref 0)."""
    area = abs(page.rect) or 1.0
    out = []
    for info in page.get_image_info(xrefs=True):
        xref = info.get("xref", 0)
        if not xref:
            continue
        raw_bbox = pymupdf.Rect(info["bbox"])
        if raw_bbox.is_empty:
            continue
        bbox = raw_bbox & page.rect
        if bbox.is_empty:
            continue
        # geometric mean handles rotated placements (bbox axes swapped);
        # DPI is computed from the unclipped bbox so an off-page placement
        # doesn't inflate the effective resolution.
        dpi = math.sqrt((info["width"] * info["height"]) / (raw_bbox.width * raw_bbox.height)) * 72
        out.append(Placement(
            xref, info["width"], info["height"], dpi, abs(bbox) / area,
            tuple(round(v, 1) for v in bbox),
        ))
    return out


def is_scan(page: pymupdf.Page, places: list[Placement]) -> bool:
    if not places or max(p.coverage for p in places) < SCAN_COVERAGE:
        return False
    return len(page.get_text("text").strip()) < SCAN_MAX_TEXT_CHARS


def stream_len(obj) -> int:
    try:
        return int(obj.get("/Length", 0))
    except (TypeError, ValueError):
        return len(obj.read_raw_bytes())


def image_size(pdf: pikepdf.Pdf, xref: int) -> int:
    """Compressed bytes of an image XObject including its soft mask."""
    obj = pdf.get_object((xref, 0))
    size = stream_len(obj)
    smask = obj.get("/SMask")
    if isinstance(smask, pikepdf.Stream):
        size += stream_len(smask)
    return size


def _font_file_len(font) -> int:
    total = 0
    fonts = [font]
    if "/DescendantFonts" in font:
        fonts += list(font.DescendantFonts)
    for f in fonts:
        desc = f.get("/FontDescriptor")
        if desc is None:
            continue
        for key in ("/FontFile", "/FontFile2", "/FontFile3"):
            ff = desc.get(key)
            if isinstance(ff, pikepdf.Stream):
                total += stream_len(ff)
    return total


def font_size(pdf: pikepdf.Pdf, xref: int) -> int:
    try:
        return _font_file_len(pdf.get_object((xref, 0)))
    except Exception:
        return 0


def content_size(pdf: pikepdf.Pdf, page_index: int) -> int:
    contents = pdf.pages[page_index].obj.get("/Contents")
    if contents is None:
        return 0
    if isinstance(contents, pikepdf.Array):
        return sum(stream_len(c) for c in contents)
    return stream_len(contents)


def page_sizes(fdoc: pymupdf.Document, pdf: pikepdf.Pdf, progress=None) -> list[int]:
    """Estimated bytes attributable to each page. Shared images/fonts split evenly."""
    usage: dict[int, list[int]] = {}
    font_usage: dict[int, list[int]] = {}
    base = []
    n = fdoc.page_count
    for i, page in enumerate(fdoc):
        for x in {p.xref for p in placements(page)}:
            usage.setdefault(x, []).append(i)
        for f in page.get_fonts():
            font_usage.setdefault(f[0], []).append(i)
        base.append(content_size(pdf, i))
        if progress and i % 20 == 0:
            progress(i / n)
    sizes = [float(b) for b in base]
    for x, pages in usage.items():
        share = image_size(pdf, x) / len(pages)
        for i in pages:
            sizes[i] += share
    for x, pages in font_usage.items():
        share = font_size(pdf, x) / len(pages)
        for i in pages:
            sizes[i] += share
    return [int(s) for s in sizes]
