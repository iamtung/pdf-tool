"""Build the analysis report for a document (spec §4.2)."""
import statistics
from collections import Counter
from pathlib import Path

import pikepdf
import pymupdf

from pdftool.core import inspect

HEAVY_FACTOR = 3
HEAVY_MIN_BYTES = 1_000_000
IMAGE_HEAVY_SHARE = 0.5
TOP_IMAGES = 10
MB = 1_000_000


def overview(fdoc: pymupdf.Document, path: Path) -> dict:
    meta = fdoc.metadata or {}
    return {
        "size": path.stat().st_size,
        "pageCount": fdoc.page_count,
        "version": (meta.get("format") or "").replace("PDF ", "") or None,
        "encrypted": bool(fdoc.is_encrypted or meta.get("encryption")),
        "producer": meta.get("producer") or None,
        "creator": meta.get("creator") or None,
        "pages": [
            {"width": round(p.rect.width, 1), "height": round(p.rect.height, 1), "rotation": p.rotation}
            for p in fdoc
        ],
    }


def composition(pdf: pikepdf.Pdf, file_size: int) -> dict:
    font_files: set[tuple] = set()
    for obj in pdf.objects:
        if isinstance(obj, pikepdf.Dictionary) and obj.get("/Type") == "/FontDescriptor":
            for key in ("/FontFile", "/FontFile2", "/FontFile3"):
                ff = obj.get(key)
                if isinstance(ff, pikepdf.Stream):
                    font_files.add(ff.objgen)
    images = fonts = content = 0
    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Stream):
            continue
        n = inspect.stream_len(obj)
        if obj.get("/Subtype") == "/Image":
            images += n
        elif obj.objgen in font_files:
            fonts += n
        elif obj.get("/Subtype") == "/Form":
            content += n
    for page in pdf.pages:
        c = page.obj.get("/Contents")
        for s in (c if isinstance(c, pikepdf.Array) else [c] if c is not None else []):
            content += inspect.stream_len(s)
    other = max(file_size - images - fonts - content, 0)
    return {"images": images, "fonts": fonts, "content": content, "other": other}


def analyze(path: Path, password: str | None = None, progress=None) -> dict:
    """Full report. progress(fraction, message) is optional."""
    report_progress = progress or (lambda f, m: None)
    fdoc = pymupdf.open(path)
    if password:
        fdoc.authenticate(password)
    pdf = pikepdf.open(path, password=password or "")
    try:
        file_size = path.stat().st_size
        report = overview(fdoc, path)
        report_progress(0.05, "Đang tính dung lượng theo thành phần")
        report["composition"] = composition(pdf, file_size)

        report_progress(0.2, "Đang phân tích từng trang")
        sizes = inspect.page_sizes(fdoc, pdf, lambda f: report_progress(0.2 + 0.6 * f, "Đang phân tích từng trang"))
        median = statistics.median(sizes) if sizes else 0
        images: dict[int, dict] = {}
        pages = []
        for i, page in enumerate(fdoc):
            places = inspect.placements(page)
            img_bytes = 0
            for p in places:
                info = images.get(p.xref)
                if info is None:
                    info = images[p.xref] = _image_info(pdf, p)
                info["dpi"] = max(info["dpi"], round(p.dpi))
                if i not in info["pages"]:
                    info["pages"].append(i)
            for x in {p.xref for p in places}:
                img_bytes += images[x]["size"]
            if inspect.is_scan(page, places):
                kind = "scan"
            elif sizes[i] and img_bytes / max(sizes[i], 1) >= IMAGE_HEAVY_SHARE:
                kind = "image_heavy"
            else:
                kind = "vector"
            pages.append({
                "index": i,
                "size": sizes[i],
                "kind": kind,
                "width": round(page.rect.width, 1),
                "height": round(page.rect.height, 1),
                "imageCount": len({p.xref for p in places}),
                "maxDpi": round(max((p.dpi for p in places), default=0)),
                "fontCount": len(page.get_fonts()),
                "images": sorted({p.xref for p in places}),
                "placements": [{"xref": p.xref, "bbox": list(p.bbox)} for p in places],
                "heavy": sizes[i] > HEAVY_FACTOR * median and sizes[i] > HEAVY_MIN_BYTES,
            })
        report["pagesDetail"] = pages
        report["kinds"] = dict(Counter(p["kind"] for p in pages))
        report["topImages"] = sorted(images.values(), key=lambda im: -im["size"])[:TOP_IMAGES]
        report["images"] = {str(x): im for x, im in images.items()}
        report["suggestions"] = suggestions(report)
        report_progress(1.0, "Xong")
        return report
    finally:
        pdf.close()
        fdoc.close()


def _image_info(pdf: pikepdf.Pdf, p: inspect.Placement) -> dict:
    obj = pdf.get_object((p.xref, 0))
    filt = obj.get("/Filter")
    if isinstance(filt, pikepdf.Array):
        filt = filt[-1] if len(filt) else None
    cs = obj.get("/ColorSpace")
    if isinstance(cs, pikepdf.Array):
        cs = cs[0]
    return {
        "xref": p.xref,
        "width": p.width,
        "height": p.height,
        "dpi": 0,
        "filter": str(filt).lstrip("/") if filt is not None else None,
        "colorspace": str(cs).lstrip("/") if cs is not None else None,
        "size": inspect.image_size(pdf, p.xref),
        "pages": [],
    }


def suggestions(report: dict) -> list[str]:
    out = []
    pages = report["pagesDetail"]
    comp = report["composition"]
    total = report["size"] or 1
    scans = [p for p in pages if p["kind"] == "scan" and p["maxDpi"] > 300]
    if scans:
        dpi = round(statistics.median(p["maxDpi"] for p in scans))
        before = sum(p["size"] for p in scans)
        after = sum(p["size"] * min(1.0, (150 / p["maxDpi"]) ** 2) * 0.7 for p in scans)
        est = total - before + after
        out.append(
            f"{len(scans)} trang scan ở ~{dpi} DPI. Nén mức Vừa (150 DPI) ước tính file còn ~{est / MB:.0f} MB."
        )
    hi_dpi = [im for im in report["topImages"] if im["dpi"] > 250]
    if comp["images"] / total > 0.5 and hi_dpi and not scans:
        out.append(
            f"Ảnh chiếm {comp['images'] / total:.0%} dung lượng, nhiều ảnh trên 250 DPI. Thử mức Cân bằng."
        )
    if comp["fonts"] / total > 0.3:
        out.append(f"Font nhúng chiếm {comp['fonts'] / total:.0%} dung lượng. Mức Chất lượng cao sẽ dọn font không dùng.")
    if comp["other"] / total > 0.3:
        out.append(
            f"~{comp['other'] / MB:.0f} MB là dữ liệu phụ hoặc object thừa. Lưu tối ưu (bất kỳ mức nén nào) sẽ dọn phần này."
        )
    return out[:3]
