"""Per-image recompression with pikepdf + Pillow, and Ghostscript (spec §4.6).

Only image XObjects are touched; text and vector content are never rasterized.
"""
import io
import shutil
import subprocess
import zlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pikepdf
import pymupdf
from PIL import Image

from pdftool.core import inspect
from pdftool.core.errors import PdfToolError
from pdftool.core.plan import ImageSettings, lightest

DOWNSAMPLE_MARGIN = 1.25    # only downsample when DPI exceeds the cap by >= 25%
MIN_GAIN = 0.9              # keep new stream only if it is <= 90% of the old one
GRAY_THRESHOLD = 12         # spec: p95 of max channel difference < 12
HANDLED_COLORSPACES = {"/DeviceRGB", "/DeviceGray", "/ICCBased", "/CalRGB", "/CalGray"}


@dataclass
class CompressReport:
    images_total: int = 0
    images_recompressed: int = 0
    images_skipped: int = 0
    warnings: list[str] = field(default_factory=list)


def is_near_gray(img: Image.Image) -> bool:
    small = img.convert("RGB")
    small.thumbnail((256, 256))
    a = np.asarray(small, dtype=np.int16)
    diff = np.max(np.abs(np.stack([a[..., 0] - a[..., 1], a[..., 1] - a[..., 2], a[..., 0] - a[..., 2]])), axis=0)
    return float(np.percentile(diff, 95)) < GRAY_THRESHOLD


@dataclass
class _Target:
    settings: ImageSettings
    dpi: float          # lowest effective DPI among placements (largest on-page size)
    on_scan: bool       # placed on at least one scan page


def _collect(path: Path, page_settings: list[ImageSettings | None]) -> dict[int, _Target]:
    per_xref: dict[int, list[tuple[ImageSettings, float, bool]]] = {}
    protected: set[int] = set()
    with pymupdf.open(path) as fdoc:
        for i, page in enumerate(fdoc):
            s = page_settings[i] if i < len(page_settings) else None
            places = inspect.placements(page)
            if s is None:
                # None = untouched: any image also used on this page must be
                # protected everywhere, even where it appears with real settings.
                protected.update(p.xref for p in places)
                continue
            scan = inspect.is_scan(page, places)
            for p in places:
                per_xref.setdefault(p.xref, []).append((s, p.dpi, scan))
    return {
        x: _Target(lightest([e[0] for e in entries]), min(e[1] for e in entries), any(e[2] for e in entries))
        for x, entries in per_xref.items()
        if x not in protected
    }


def _colorspace_name(obj) -> str | None:
    cs = obj.get("/ColorSpace")
    if isinstance(cs, pikepdf.Array) and len(cs):
        name = str(cs[0])
        if name == "/ICCBased":
            n = int(cs[1].get("/N", 0))
            return name if n in (1, 3) else None
        return name
    return str(cs) if cs is not None else None


def _filter_names(obj) -> list[str]:
    f = obj.get("/Filter")
    if f is None:
        return []
    if isinstance(f, pikepdf.Array):
        return [str(x) for x in f]
    return [str(f)]


def _resize(img: Image.Image, scale: float) -> Image.Image:
    if scale >= 1:
        return img
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(size, Image.Resampling.LANCZOS)


def _jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def _recompress_one(pdf: pikepdf.Pdf, xref: int, t: _Target, report: CompressReport) -> None:
    report.images_total += 1
    obj = pdf.get_object((xref, 0))
    if not isinstance(obj, pikepdf.Stream) or obj.get("/Subtype") != pikepdf.Name.Image:
        report.images_skipped += 1
        return
    try:
        _recompress_body(pdf, xref, obj, t, report)
    except Exception as e:  # one bad image must not abort the whole job
        report.images_skipped += 1
        report.warnings.append(f"Bỏ qua ảnh {xref}: {type(e).__name__}.")


def _recompress_body(pdf: pikepdf.Pdf, xref: int, obj, t: _Target, report: CompressReport) -> None:
    if obj.get("/ImageMask") or int(obj.get("/BitsPerComponent", 8)) != 8 or "/Decode" in obj:
        report.images_skipped += 1
        return
    if isinstance(obj.get("/Mask"), pikepdf.Array):  # colour-key mask: not representable after re-encode
        report.images_skipped += 1
        return
    cs = _colorspace_name(obj)
    if cs not in HANDLED_COLORSPACES:
        report.images_skipped += 1
        return
    if "/DCTDecode" in _filter_names(obj) and "/DecodeParms" in obj:
        # e.g. ColorTransform - PIL can't be relied on to honour DCT DecodeParms.
        report.images_skipped += 1
        return

    # apply_mask=False: pikepdf >= 10 defaults to compositing the SMask into
    # an RGBA image, which would make every image-with-transparency bail out
    # at the mode check below. We handle the mask ourselves.
    img = pikepdf.PdfImage(obj).as_pil_image(apply_mask=False)
    if img.mode not in ("RGB", "L"):
        report.images_skipped += 1
        return

    smask = obj.get("/SMask")
    has_matte = isinstance(smask, pikepdf.Stream) and "/Matte" in smask

    cap = t.settings.max_dpi
    scale = cap / t.dpi if t.dpi > cap * DOWNSAMPLE_MARGIN else 1.0
    img = _resize(img, scale)
    gray = img.mode == "L"
    converted = False
    # A Matte holds one entry per colour channel (premultiplied against a
    # backdrop colour) - converting the image to grayscale would desync it.
    if not gray and not has_matte and t.settings.grayscale_scans and t.on_scan and is_near_gray(img):
        img = img.convert("L")
        gray = True
        converted = True

    old_len = inspect.image_size(pdf, xref)
    data = _jpeg(img, t.settings.quality)

    resized = scale < 1
    new_mask = None
    old_mask_len = 0
    if isinstance(smask, pikepdf.Stream):
        old_mask_len = inspect.stream_len(smask)
        if resized:
            # Always keep the SMask in lockstep with the image size, Matte or
            # not - the spec requires them to match dimensions.
            mask_img = pikepdf.PdfImage(smask).as_pil_image().convert("L")
            mask_img = mask_img.resize(img.size, Image.Resampling.LANCZOS)
            new_mask = zlib.compress(mask_img.tobytes(), 9)

    new_len = len(data) + (len(new_mask) if new_mask is not None else old_mask_len)
    if new_len > old_len * MIN_GAIN:
        report.images_skipped += 1
        return

    obj.write(data, filter=pikepdf.Name.DCTDecode)
    obj.Width, obj.Height = img.width, img.height
    obj.BitsPerComponent = 8
    if converted:
        obj.ColorSpace = pikepdf.Name.DeviceGray
    if "/DecodeParms" in obj:
        del obj.DecodeParms
    if new_mask is not None:
        smask.write(new_mask, filter=pikepdf.Name.FlateDecode)
        smask.Width, smask.Height = img.width, img.height
        smask.BitsPerComponent = 8
        smask.ColorSpace = pikepdf.Name.DeviceGray
        if "/DecodeParms" in smask:
            del smask.DecodeParms
    report.images_recompressed += 1


def save_optimized(pdf: pikepdf.Pdf, out_path: Path, strip_metadata: bool = False) -> None:
    """Always applied on export: object streams, compressed streams, drop unused resources."""
    pdf.remove_unreferenced_resources()
    if strip_metadata:
        if "/Metadata" in pdf.Root:
            del pdf.Root.Metadata
        for key in list(pdf.docinfo.keys()):
            del pdf.docinfo[key]
    pdf.save(
        out_path,
        object_stream_mode=pikepdf.ObjectStreamMode.generate,
        compress_streams=True,
        stream_decode_level=pikepdf.StreamDecodeLevel.generalized,
    )


def optimize(
    in_path: Path,
    out_path: Path,
    page_settings: list[ImageSettings | None],
    *,
    strip_metadata: bool = False,
    progress=None,
) -> CompressReport:
    """Recompress images page by page. page_settings[i] = settings for page i (None = untouched)."""
    report = CompressReport()
    targets = _collect(in_path, page_settings)
    with pikepdf.open(in_path) as pdf:
        n = len(targets)
        for k, (xref, t) in enumerate(targets.items()):
            _recompress_one(pdf, xref, t, report)
            if progress and k % 5 == 0:
                progress(k / max(n, 1))
        save_optimized(pdf, out_path, strip_metadata)
    return report


def ghostscript_available() -> bool:
    return shutil.which("gs") is not None


def ghostscript(in_path: Path, out_path: Path, settings: ImageSettings | None = None) -> None:
    """Rewrite the whole file with Ghostscript. settings=None means /screen."""
    gs = shutil.which("gs")
    if gs is None:
        raise PdfToolError("gs_missing", "Chưa cài Ghostscript. Chạy: brew install ghostscript")
    args = [gs, "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.6"]
    if settings is None:
        args.append("-dPDFSETTINGS=/screen")
    else:
        dpi = str(settings.max_dpi)
        args += [
            "-dPDFSETTINGS=/ebook",
            "-dDownsampleColorImages=true", "-dDownsampleGrayImages=true",
            "-dColorImageDownsampleType=/Bicubic", "-dGrayImageDownsampleType=/Bicubic",
            f"-dColorImageResolution={dpi}", f"-dGrayImageResolution={dpi}",
            "-dColorImageDownsampleThreshold=1.25", "-dGrayImageDownsampleThreshold=1.25",
            f"-dJPEGQ={settings.quality}",
        ]
    args += [f"-sOutputFile={out_path}", str(in_path)]
    out_path.unlink(missing_ok=True)
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        raise PdfToolError("internal", "Ghostscript quá thời gian.")
    if result.returncode != 0 or not out_path.exists():
        raise PdfToolError("internal", f"Ghostscript lỗi: {result.stderr.strip()[:300]}")
