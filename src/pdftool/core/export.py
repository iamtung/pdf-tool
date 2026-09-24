"""Export pipeline: assemble -> compress (per page / whole file / target size) -> split -> atomic write."""
import errno
import math
import os
import re
import secrets
import shutil
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import pikepdf
import pymupdf

from pdftool.core import compressor, estimate
from pdftool.core.assemble import Sources, assemble
from pdftool.core.errors import PdfToolError
from pdftool.core.plan import (
    LEVELS, FileSettings, ImageSettings, Plan, page_overrides, resolve_file, target_ladder,
)

TARGET_BUDGET = 0.9
MAX_PASSES = 3          # full optimize passes in target mode (spec §4.6: first run + 2 retries)
SPLIT_FILL = 0.95
MB = 1_000_000
DEST_FREE_FACTOR = 2    # spec §7: >= 2x the source size free at the destination
WORK_FREE_FACTOR = 3    # assembled + compressed passes + parts live in the workdir
# Same volume for both: DEST_FREE_FACTOR + WORK_FREE_FACTOR (= 5x) on that volume.
DEST_MANIFEST = "dest-tmp.txt"

DISK_FULL_MSG = "Ổ đĩa không đủ chỗ trống để xuất file."
DEST_NOT_WRITABLE_MSG = "Không ghi được vào thư mục đích. Hãy chọn thư mục khác."
GS_FAILED_NOTE = "Ghostscript lỗi, giữ kết quả nén thường."


@dataclass
class ExportOptions:
    dest_dir: Path
    base_name: str
    split: dict | None = None  # {"mode": "ranges", "ranges": "1-3,4-9"} | {"mode": "size", "maxMB": 20}


@dataclass
class Compressed:
    path: Path
    notes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    level: ImageSettings | None = None
    target_met: bool | None = None
    split_suggestion: int | None = None


def _progress(cb, lo: float, hi: float, msg: str):
    return (lambda f: cb(lo + (hi - lo) * f, msg)) if cb else None


# ---------------------------------------------------------------- safe writes

def unique_path(dest_dir: Path, stem: str) -> Path:
    candidate = dest_dir / f"{stem}.pdf"
    n = 2
    while candidate.exists():
        candidate = dest_dir / f"{stem} ({n}).pdf"
        n += 1
    return candidate


def _create_tmp(dest_dir: Path, stem: str):
    """Exclusively create `<stem>.<8 hex>.tmp.pdf`; never reuses an existing file."""
    for _ in range(100):
        tmp = dest_dir / f"{stem}.{secrets.token_hex(4)}.tmp.pdf"
        try:
            return os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644), tmp
        except FileExistsError:
            continue
    raise PdfToolError("internal", "Không tạo được file tạm ở thư mục đích.")


def _publish(tmp: Path, dest_dir: Path, stem: str) -> Path:
    """Give tmp its final name without ever replacing a file that exists."""
    while True:
        final = unique_path(dest_dir, stem)
        try:
            os.link(tmp, final)  # fails with FileExistsError instead of overwriting
            return final
        except FileExistsError:
            continue  # someone created that name meanwhile: pick the next one
        except OSError as e:
            if e.errno == errno.ENOSPC:
                raise
            # Volume without hard links (e.g. exFAT/FAT USB drives): best-effort rename.
            if final.exists():
                continue
            os.rename(tmp, final)
            return final


def atomic_write(src: Path, dest_dir: Path, stem: str, expected_pages: int, manifest: Path | None = None) -> Path:
    """Copy src into a fresh tmp file next to its final name, verify it opens, then link it into place.

    `manifest` (inside the job workdir) records every tmp path before it is written so a
    cancelled job can remove it with `cleanup_dest_tmp`.
    """
    fd, tmp = _create_tmp(dest_dir, stem)
    try:
        with os.fdopen(fd, "wb") as out:
            if manifest is not None:
                with open(manifest, "a", encoding="utf-8") as m:
                    m.write(f"{tmp}\n")
            with open(src, "rb") as inp:
                shutil.copyfileobj(inp, out, 1 << 20)
        with pymupdf.open(tmp) as d:
            if d.page_count != expected_pages:
                raise PdfToolError("internal", "File xuất ra bị lỗi (sai số trang).")
        return _publish(tmp, dest_dir, stem)
    finally:
        tmp.unlink(missing_ok=True)


def cleanup_dest_tmp(workdir: Path) -> list[Path]:
    """Delete destination tmp files listed in the job's manifest (call after cancelling a job)."""
    manifest = workdir / DEST_MANIFEST
    if not manifest.exists():
        return []
    removed = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line.endswith(".tmp.pdf"):
            continue
        p = Path(line)
        try:
            p.unlink()
            removed.append(p)
        except FileNotFoundError:
            pass
    manifest.unlink(missing_ok=True)
    return removed


def _check_space(path: Path, need: int) -> None:
    if shutil.disk_usage(path).free < need:
        raise PdfToolError("disk_full", DISK_FULL_MSG)


def _ghostscript(src: Path, out: Path, settings: ImageSettings | None = None) -> None:
    """compressor.ghostscript, with an out-of-space failure reported as disk_full."""
    try:
        compressor.ghostscript(src, out, settings)
    except PdfToolError as e:
        if e.code != "disk_full" and "No space left" in e.message:
            out.unlink(missing_ok=True)
            raise PdfToolError("disk_full", DISK_FULL_MSG) from e
        raise


@contextmanager
def _dest_access():
    """Report a destination that can't be created/written (read-only folder, no permission) clearly."""
    try:
        yield
    except PermissionError as e:
        raise PdfToolError("bad_request", DEST_NOT_WRITABLE_MSG) from e


def _is_disk_full(e: BaseException) -> bool:
    return (isinstance(e, OSError) and e.errno == errno.ENOSPC) or "No space left on device" in str(e)


# ---------------------------------------------------------------- split options

def parse_ranges(text: str, page_count: int) -> list[list[int]]:
    parts = []
    for chunk in filter(None, (c.strip() for c in text.split(","))):
        m = re.fullmatch(r"(\d+)\s*(?:-\s*(\d+))?", chunk)
        if not m:
            raise PdfToolError("bad_request", f"Khoảng trang không hợp lệ: '{chunk}'")
        a, b = int(m[1]), int(m[2] or m[1])
        if not (1 <= a <= b <= page_count):
            raise PdfToolError("bad_request", f"Khoảng trang '{chunk}' nằm ngoài 1–{page_count}")
        parts.append(list(range(a - 1, b)))
    if not parts:
        raise PdfToolError("bad_request", "Chưa nhập khoảng trang.")
    return parts


def group_by_size(sizes: list[int], limit: int) -> list[list[int]]:
    """Greedy consecutive grouping so each group's size <= SPLIT_FILL * limit."""
    cap = SPLIT_FILL * limit
    groups, cur, total = [], [], 0
    for i, s in enumerate(sizes):
        if cur and total + s > cap:
            groups.append(cur)
            cur, total = [], 0
        cur.append(i)
        total += s
    if cur:
        groups.append(cur)
    return groups


def validate_split(split: dict | None, page_count: int) -> tuple[str, object] | None:
    """Check split options up front: ("ranges", groups) | ("size", limit_bytes) | None."""
    if split is None:
        return None
    mode = split.get("mode") if isinstance(split, dict) else None
    if mode == "ranges":
        return "ranges", parse_ranges(str(split.get("ranges") or ""), page_count)
    if mode == "size":
        try:
            mb = float(split["maxMB"])
        except (KeyError, TypeError, ValueError):
            raise PdfToolError("bad_request", "Chưa nhập dung lượng tối đa mỗi phần.")
        if not math.isfinite(mb) or mb <= 0 or int(mb * MB) < 1:
            raise PdfToolError("bad_request", "Dung lượng tối đa mỗi phần phải lớn hơn 0.")
        return "size", int(mb * MB)
    raise PdfToolError("bad_request", "Chế độ tách không hợp lệ.")


# ---------------------------------------------------------------- compression

def _page_settings(n: int, overrides: dict[int, ImageSettings], base: ImageSettings | None) -> list[ImageSettings | None]:
    return [overrides.get(i, base) for i in range(n)]


def _strip_metadata(path: Path, out: Path) -> Path:
    """Rewrite path without Info dict / XMP (used for files not produced by compressor.optimize)."""
    with pikepdf.open(path) as pdf:
        compressor.save_optimized(pdf, out, strip_metadata=True)
    return out


def _split_suggestion(size: int, target: int) -> int | None:
    return None if size <= target else math.ceil(size / (TARGET_BUDGET * target))


def _set_target(c: Compressed, target: int) -> None:
    size = c.path.stat().st_size
    c.target_met = size <= target
    c.split_suggestion = _split_suggestion(size, target)


def compress_to_target(
    src: Path, n: int, overrides: dict[int, ImageSettings], fs: FileSettings, workdir: Path, progress=None
) -> Compressed:
    """Spec §4.6 'nén về dưới X MB'."""
    target = fs.target_bytes
    budget = TARGET_BUDGET * target
    ladder = target_ladder(fs)
    sizes = estimate.measure_sizes(src)
    free = [i for i in range(n) if i not in overrides]
    groups: dict[ImageSettings, list[int]] = {}
    for i, s in overrides.items():
        groups.setdefault(s, []).append(i)
    fixed = sum(estimate.estimate(src, sizes, pages, s, workdir) for s, pages in groups.items())
    sample = estimate.prepare(src, sizes, free, workdir)  # extracted once, reused for every rung

    def est(k: int) -> int:
        return fixed + (sample.estimate(ladder[k]) if sample else 0)

    last = len(ladder) - 1
    rung = last
    for k in range(len(ladder)):
        if progress:
            progress(0.3 * k / len(ladder))
        if est(k) <= budget:
            rung = k
            break

    best: Compressed | None = None
    ran_last = False
    for p in range(MAX_PASSES):
        if progress:
            progress(0.3 + 0.6 * p / MAX_PASSES)
        out = workdir / f"target-{p + 1}.pdf"
        rep = compressor.optimize(src, out, _page_settings(n, overrides, ladder[rung]), strip_metadata=fs.strip_metadata)
        ran_last = ran_last or rung == last
        size = out.stat().st_size
        if best is None or size < best.path.stat().st_size:
            if best is not None:
                best.path.unlink(missing_ok=True)
            best = Compressed(path=out, warnings=rep.warnings, level=ladder[rung])
        else:
            out.unlink(missing_ok=True)
        if size <= target or rung == last or not free:
            break
        # Correct the estimates by what the full pass actually produced and jump
        # straight to the lightest rung expected to fit (at least one step heavier).
        factor = size / max(est(rung), 1)
        rung = next((k for k in range(rung + 1, last + 1) if est(k) * factor <= budget), last)
        if p + 1 == MAX_PASSES - 1:
            rung = last  # the final allowed pass must be the strongest rung (spec step 5)

    if sample:
        sample.close()
    result = best
    if result.path.stat().st_size > target:
        if overrides:
            result.notes.append("Bỏ qua Ghostscript vì có trang mang mức nén riêng.")
        elif ran_last and compressor.ghostscript_available():
            gs_out = workdir / "target-gs.pdf"
            try:
                _ghostscript(src, gs_out)
                if fs.strip_metadata:
                    gs_out = _strip_metadata(gs_out, workdir / "target-gs-clean.pdf")
                if gs_out.stat().st_size < result.path.stat().st_size:
                    result.path = gs_out
                    result.notes.append("Đã dùng Ghostscript /screen để nén mạnh nhất.")
            except PdfToolError as e:
                if e.code == "disk_full":
                    raise
                result.notes.append(GS_FAILED_NOTE)
    _set_target(result, target)
    return result


def compress(plan: Plan, src: Path, workdir: Path, progress=None) -> Compressed | None:
    """Apply resolved compression to the assembled file. None = nothing to compress."""
    n = len(plan.pages)
    overrides = page_overrides(plan)
    fs = resolve_file(plan.fileCompression)
    if fs is None and not overrides:
        return None
    if fs is not None and fs.use_ghostscript:
        out = workdir / "gs.pdf"
        _ghostscript(src, out, fs.image)
        if fs.strip_metadata:
            out = _strip_metadata(out, workdir / "gs-clean.pdf")
        c = Compressed(path=out, level=fs.image)
        if overrides:
            c.notes.append("Ghostscript nén đồng đều cả file; mức riêng từng trang không được áp dụng.")
        if fs.target_bytes is not None:
            _set_target(c, fs.target_bytes)
        return c
    if fs is not None and fs.target_bytes is not None:
        return compress_to_target(src, n, overrides, fs, workdir, progress)
    out = workdir / "compressed.pdf"
    base = fs.image if fs else None
    rep = compressor.optimize(
        src, out, _page_settings(n, overrides, base),
        strip_metadata=fs.strip_metadata if fs else False, progress=progress,
    )
    return Compressed(path=out, warnings=rep.warnings, level=base)


# ---------------------------------------------------------------- export

def _write_parts(final: Path, groups: list[list[int]], opts: ExportOptions, stem: str, limit: int | None,
                 workdir: Path, warnings: list[str], strip: bool = False,
                 manifest: Path | None = None) -> list[Path]:
    """Write each group as a part. With a size limit, halve oversize multi-page parts (spec §4.7)."""
    queue = [g for g in groups]
    parts: list[tuple[list[int], Path]] = []
    k = 0
    while queue:
        g = queue.pop(0)
        k += 1
        tmp = workdir / f"part-{k}.pdf"
        with pikepdf.open(final) as pdf, pikepdf.new() as new:
            for i in g:
                new.pages.append(pdf.pages[i])
            compressor.save_optimized(new, tmp, strip_metadata=strip)
        if limit and tmp.stat().st_size > limit:
            if len(g) > 1:
                mid = len(g) // 2
                queue[:0] = [g[:mid], g[mid:]]
                tmp.unlink(missing_ok=True)
                continue
            warnings.append(f"Trang {g[0] + 1} lớn hơn giới hạn mỗi phần, được xuất thành một phần riêng.")
        parts.append((g, tmp))
    parts.sort(key=lambda p: p[0][0])
    return [
        atomic_write(tmp, opts.dest_dir, f"{stem}_part{n}", len(g), manifest) for n, (g, tmp) in enumerate(parts, 1)
    ]


def run_export(plan: Plan, sources: Sources, opts: ExportOptions, workdir: Path, progress=None) -> dict:
    try:
        return _run_export(plan, sources, opts, workdir, progress)
    except PdfToolError:
        raise
    except Exception as e:
        if _is_disk_full(e):
            raise PdfToolError("disk_full", DISK_FULL_MSG) from e
        raise


def _run_export(plan: Plan, sources: Sources, opts: ExportOptions, workdir: Path, progress=None) -> dict:
    if not plan.pages:
        raise PdfToolError("bad_request", "Không có trang nào để xuất.")
    n = len(plan.pages)
    split = validate_split(opts.split, n)  # before any heavy work
    used = {p.source.docId for p in plan.pages if p.source.type == "pdf"}
    original_size = sum(Path(sources[d]["path"]).stat().st_size for d in used)
    with _dest_access():
        opts.dest_dir.mkdir(parents=True, exist_ok=True)
        if not os.access(opts.dest_dir, os.W_OK | os.X_OK):
            raise PermissionError(opts.dest_dir)  # fail before any heavy work
    workdir.mkdir(parents=True, exist_ok=True)
    if os.stat(opts.dest_dir).st_dev == os.stat(workdir).st_dev:
        _check_space(workdir, (DEST_FREE_FACTOR + WORK_FREE_FACTOR) * original_size)
    else:
        _check_space(opts.dest_dir, DEST_FREE_FACTOR * original_size)
        _check_space(workdir, WORK_FREE_FACTOR * original_size)
    manifest = workdir / DEST_MANIFEST

    assembled = workdir / "assembled.pdf"
    if progress:
        progress(0.02, "Đang dựng file")
    assemble(plan, sources, assembled, _progress(progress, 0.02, 0.15, "Đang dựng file"))

    fs = resolve_file(plan.fileCompression)
    strip = bool(fs and fs.strip_metadata)
    if progress:
        progress(0.15, "Đang nén")
    comp = compress(plan, assembled, workdir, _progress(progress, 0.15, 0.85, "Đang nén"))
    # baseline = edit-only file, still saved with object streams / unused-object cleanup
    baseline = workdir / "packed.pdf"
    with pikepdf.open(assembled) as pdf:
        compressor.save_optimized(pdf, baseline, strip_metadata=strip)
    if not strip and baseline.stat().st_size >= assembled.stat().st_size:
        baseline = assembled  # the assembled file still carries metadata, so only when not stripping
    final, already_optimal = baseline, False
    if comp is not None:
        if comp.path.stat().st_size < baseline.stat().st_size:
            final = comp.path
        else:
            already_optimal = True
    compressed = comp is not None and not already_optimal

    target_met = split_suggestion = None
    if fs is not None and fs.target_bytes is not None and comp is not None:
        size = final.stat().st_size  # judged on the file actually written
        target_met = size <= fs.target_bytes
        split_suggestion = _split_suggestion(size, fs.target_bytes)

    stem = opts.base_name + ("_compressed" if compressed else "_edited")
    warnings = list(comp.warnings) if comp else []
    if progress:
        progress(0.9, "Đang ghi file")
    with _dest_access():
        if split is None:
            outputs = [atomic_write(final, opts.dest_dir, stem, n, manifest)]
        elif split[0] == "ranges":
            outputs = _write_parts(final, split[1], opts, stem, None, workdir, warnings, strip, manifest)
        else:
            limit = split[1]
            groups = group_by_size(estimate.measure_sizes(final), limit)
            outputs = _write_parts(final, groups, opts, stem, limit, workdir, warnings, strip, manifest)
    manifest.unlink(missing_ok=True)  # every tmp is gone once the writes returned

    result_size = sum(p.stat().st_size for p in outputs)
    notes = list(comp.notes) if comp else []
    if already_optimal:
        notes.append("File đã tối ưu, không giảm thêm được.")
    level = comp.level if compressed else None
    return {
        "outputs": [{"path": str(p), "size": p.stat().st_size, "name": p.name} for p in outputs],
        "originalSize": original_size,
        "resultSize": result_size,
        "compressed": compressed,
        "alreadyOptimal": already_optimal,
        "level": {"maxDpi": level.max_dpi, "quality": level.quality} if level else None,
        "targetMet": target_met,
        "splitSuggestion": split_suggestion,
        "notes": notes,
        "warnings": warnings,
    }


def run_estimate(plan: Plan, sources: Sources, page_ids: list[str] | None, level: str | None,
                 workdir: Path, progress=None) -> dict:
    """Estimate for selected pages at a level (page scope) or the whole plan (file scope)."""
    if page_ids is not None and level not in LEVELS:
        raise PdfToolError("bad_request", "Chưa chọn mức nén hợp lệ để ước tính.")
    workdir.mkdir(parents=True, exist_ok=True)
    if page_ids is not None:
        chosen = [p for p in plan.pages if p.id in set(page_ids)]
        if not chosen:
            raise PdfToolError("bad_request", "Chưa chọn trang nào để ước tính.")
        plan = Plan(pages=chosen)
    assembled = workdir / "est-assembled.pdf"
    assemble(plan, sources, assembled)
    if progress:
        progress(0.3, "Đang ước tính")
    sizes = estimate.measure_sizes(assembled)
    original = sum(sizes)
    all_pages = list(range(len(plan.pages)))
    if page_ids is not None:
        est = estimate.estimate(assembled, sizes, all_pages, LEVELS[level], workdir)
        return {"originalBytes": original, "estimatedBytes": est}

    fs = resolve_file(plan.fileCompression)
    result = {"originalBytes": original}
    if fs is not None and fs.use_ghostscript:
        # Ghostscript rewrites the whole file uniformly: per-page levels don't apply.
        sample = estimate.prepare(assembled, sizes, all_pages, workdir)
        try:
            ratios = sample.group_ratios(("gs", fs.image), lambda raw, out: _ghostscript(raw, out, fs.image))
        finally:
            sample.close()
        result["estimatedBytes"] = sample.apply(ratios)
        if fs.target_bytes is not None:
            result["targetMet"] = result["estimatedBytes"] <= fs.target_bytes
        return result

    overrides = page_overrides(plan)
    groups: dict[ImageSettings, list[int]] = {}
    free = [i for i in all_pages if i not in overrides]
    for i, s in overrides.items():
        groups.setdefault(s, []).append(i)
    est = sum(estimate.estimate(assembled, sizes, pages, s, workdir) for s, pages in groups.items())
    if fs is None:
        est += sum(sizes[i] for i in free)
    elif fs.target_bytes is not None:
        budget = TARGET_BUDGET * fs.target_bytes - est
        sample = estimate.prepare(assembled, sizes, free, workdir)

        def free_est(s: ImageSettings) -> int:
            return sample.estimate(s) if sample else 0

        ladder = target_ladder(fs)
        chosen = next((s for s in ladder if free_est(s) <= budget), ladder[-1])
        est += free_est(chosen)
        if sample:
            sample.close()
        result["level"] = {"maxDpi": chosen.max_dpi, "quality": chosen.quality}
        result["targetMet"] = est <= fs.target_bytes
    else:
        est += estimate.estimate(assembled, sizes, free, fs.image, workdir)
    result["estimatedBytes"] = int(est)
    return result
