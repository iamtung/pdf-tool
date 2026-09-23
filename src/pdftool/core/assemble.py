"""Build a new (uncompressed) PDF from a page plan using pikepdf (spec §4.7).

pikepdf/qpdf keeps one object map per source file, so an image shared by several
source pages stays a single object in the output (PyMuPDF insert_pdf page-by-page
would duplicate it).
"""
from pathlib import Path
from typing import Callable

import pikepdf
import pymupdf

from pdftool.core.documents import open_pike
from pdftool.core.plan import Plan

IMAGE_PAGE_DPI = 150

# docId -> {"path": str, "password": str | None}
Sources = dict[str, dict]


def _single_page_pdf(build: Callable[[pymupdf.Document], None]) -> pikepdf.Pdf:
    tmp = pymupdf.open()
    build(tmp)
    data = tmp.tobytes()
    tmp.close()
    import io

    return pikepdf.open(io.BytesIO(data))


def _blank(width: float, height: float) -> pikepdf.Pdf:
    return _single_page_pdf(lambda d: d.new_page(width=width, height=height))


def _image_page(path: str) -> pikepdf.Pdf:
    def build(d: pymupdf.Document) -> None:
        pix = pymupdf.Pixmap(path)
        w, h = pix.width * 72 / IMAGE_PAGE_DPI, pix.height * 72 / IMAGE_PAGE_DPI
        page = d.new_page(width=w, height=h)
        page.insert_image(page.rect, filename=path)

    return _single_page_pdf(build)


def assemble(plan: Plan, sources: Sources, out_path: Path, progress=None) -> None:
    out = pikepdf.new()
    opened: dict[str, pikepdf.Pdf] = {}
    extras: list[pikepdf.Pdf] = []  # keep single-page docs alive until save
    n = len(plan.pages)
    try:
        for i, page in enumerate(plan.pages):
            src = page.source
            if src.type == "pdf":
                pdf = opened.get(src.docId)
                if pdf is None:
                    s = sources[src.docId]
                    pdf = opened[src.docId] = open_pike(Path(s["path"]), s.get("password"))
                out.pages.append(pdf.pages[src.index])
            else:
                extra = _blank(src.width, src.height) if src.type == "blank" else _image_page(src.path)
                extras.append(extra)
                out.pages.append(extra.pages[0])
            if page.rotate:
                out.pages[-1].rotate(page.rotate, relative=True)
            if progress and i % 50 == 0:
                progress(i / max(n, 1))
        out.save(out_path)
    finally:
        out.close()
        for pdf in [*opened.values(), *extras]:
            pdf.close()
