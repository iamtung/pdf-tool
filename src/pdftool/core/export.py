"""Export pipeline: assemble -> compress (per page / whole file / target size) -> split -> atomic write."""
import math
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

import pikepdf
import pymupdf

from pdftool.core import compressor, estimate
from pdftool.core.assemble import Sources, assemble
from pdftool.core.errors import PdfToolError
from pdftool.core.plan import LADDER, FileSettings, ImageSettings, Plan, page_overrides, resolve_file

TARGET_BUDGET = 0.9
MAX_RETRIES = 2
SPLIT_FILL = 0.95
MB = 1_000_000


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


def unique_path(dest_dir: Path, stem: str) -> Path:
    candidate = dest_dir / f"{stem}.pdf"
    n = 2
    while candidate.exists():
        candidate = dest_dir / f"{stem} ({n}).pdf"
        n += 1
    return candidate


def atomic_write(src: Path, dest_dir: Path, stem: str, expected_pages: int) -> Path:
    """Copy src next to its final name as .tmp.pdf, verify it opens, then rename."""
    final = unique_path(dest_dir, stem)
    tmp = final.with_name(final.stem + ".tmp.pdf")
    shutil.copyfile(src, tmp)
    try:
        with pymupdf.open(tmp) as d:
            if d.page_count != expected_pages:
                raise PdfToolError("internal", "File xuất ra bị lỗi (sai số trang).")
        os.replace(tmp, final)
    finally:
        tmp.unlink(missing_ok=True)
    return final


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


def _page_settings(n: int, overrides: dict[int, ImageSettings], base: ImageSettings | None) -> list[ImageSettings | None]:
    return [overrides.get(i, base) for i in range(n)]


def compress_to_target(
    src: Path, n: int, overrides: dict[int, ImageSettings], fs: FileSettings, workdir: Path, progress=None
) -> Compressed:
    """Spec §4.6 'nén về dưới X MB'."""
    target = fs.target_bytes
    sizes = estimate.measure_sizes(src)
    free = [i for i in range(n) if i not in overrides]
    fixed = 0
    for s in set(overrides.values()):
        fixed += estimate.estimate(src, sizes, [i for i, v in overrides.items() if v == s], s, workdir)
    budget = TARGET_BUDGET * target - fixed

    rung = len(LADDER) - 1
    for k, s in enumerate(LADDER):
        if progress:
            progress(0.3 * k / len(LADDER))
        if estimate.estimate(src, sizes, free, s, workdir) <= budget:
            rung = k
            break

    result = Compressed(path=workdir / "target.pdf")
    for attempt in range(MAX_RETRIES + 1):
        s = LADDER[rung]
        if progress:
            progress(0.3 + 0.2 * attempt)
        rep = compressor.optimize(
            src, result.path, _page_settings(n, overrides, s), strip_metadata=fs.strip_metadata
        )
        result.level = s
        result.warnings = rep.warnings
        if result.path.stat().st_size <= target or rung == len(LADDER) - 1:
            break
        rung += 1

    if result.path.stat().st_size > target:
        if overrides:
            result.notes.append("Bỏ qua Ghostscript vì có trang mang mức nén riêng.")
        elif compressor.ghostscript_available():
            gs_out = workdir / "target-gs.pdf"
            compressor.ghostscript(src, gs_out)
            if gs_out.stat().st_size < result.path.stat().st_size:
                result.path = gs_out
                result.notes.append("Đã dùng Ghostscript /screen để nén mạnh nhất.")
    size = result.path.stat().st_size
    result.target_met = size <= target
    if not result.target_met:
        result.split_suggestion = math.ceil(size / (TARGET_BUDGET * target))
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
        compressor.ghostscript(src, out, fs.image)
        c = Compressed(path=out, level=fs.image)
        if overrides:
            c.notes.append("Ghostscript nén đồng đều cả file; mức riêng từng trang không được áp dụng.")
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


def _write_parts(final: Path, groups: list[list[int]], opts: ExportOptions, stem: str, limit: int | None,
                 workdir: Path, warnings: list[str]) -> list[Path]:
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
            compressor.save_optimized(new, tmp)
        if limit and tmp.stat().st_size > limit:
            if len(g) > 1:
                mid = len(g) // 2
                queue[:0] = [g[:mid], g[mid:]]
                continue
            warnings.append(f"Trang {g[0] + 1} lớn hơn giới hạn mỗi phần, được xuất thành một phần riêng.")
        parts.append((g, tmp))
    parts.sort(key=lambda p: p[0][0])
    return [
        atomic_write(tmp, opts.dest_dir, f"{stem}_part{n}", len(g)) for n, (g, tmp) in enumerate(parts, 1)
    ]


def run_export(plan: Plan, sources: Sources, opts: ExportOptions, workdir: Path, progress=None) -> dict:
    if not plan.pages:
        raise PdfToolError("bad_request", "Không có trang nào để xuất.")
    used = {p.source.docId for p in plan.pages if p.source.type == "pdf"}
    original_size = sum(Path(sources[d]["path"]).stat().st_size for d in used)
    opts.dest_dir.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(opts.dest_dir).free < 2 * original_size:
        raise PdfToolError("disk_full", "Ổ đĩa không đủ chỗ trống để xuất file.")

    workdir.mkdir(parents=True, exist_ok=True)
    assembled = workdir / "assembled.pdf"
    if progress:
        progress(0.02, "Đang dựng file")
    assemble(plan, sources, assembled, _progress(progress, 0.02, 0.15, "Đang dựng file"))

    if progress:
        progress(0.15, "Đang nén")
    comp = compress(plan, assembled, workdir, _progress(progress, 0.15, 0.85, "Đang nén"))
    # baseline = edit-only file, still saved with object streams / unused-object cleanup
    baseline = workdir / "packed.pdf"
    with pikepdf.open(assembled) as pdf:
        compressor.save_optimized(pdf, baseline)
    if baseline.stat().st_size >= assembled.stat().st_size:
        baseline = assembled
    final, already_optimal = baseline, False
    if comp is not None:
        if comp.path.stat().st_size < baseline.stat().st_size:
            final = comp.path
        else:
            already_optimal = True

    stem = opts.base_name + ("_compressed" if comp is not None else "_edited")
    n = len(plan.pages)
    warnings = list(comp.warnings) if comp else []
    if progress:
        progress(0.9, "Đang ghi file")
    split = opts.split
    if split is None:
        outputs = [atomic_write(final, opts.dest_dir, stem, n)]
    elif split.get("mode") == "ranges":
        outputs = _write_parts(final, parse_ranges(split.get("ranges", ""), n), opts, stem, None, workdir, warnings)
    elif split.get("mode") == "size":
        limit = int(float(split["maxMB"]) * MB)
        groups = group_by_size(estimate.measure_sizes(final), limit)
        outputs = _write_parts(final, groups, opts, stem, limit, workdir, warnings)
    else:
        raise PdfToolError("bad_request", "Chế độ tách không hợp lệ.")

    result_size = sum(p.stat().st_size for p in outputs)
    notes = list(comp.notes) if comp else []
    if already_optimal:
        notes.append("File đã tối ưu, không giảm thêm được.")
    return {
        "outputs": [{"path": str(p), "size": p.stat().st_size, "name": p.name} for p in outputs],
        "originalSize": original_size,
        "resultSize": result_size,
        "compressed": comp is not None and not already_optimal,
        "alreadyOptimal": already_optimal,
        "level": {"maxDpi": comp.level.max_dpi, "quality": comp.level.quality} if comp and comp.level else None,
        "targetMet": comp.target_met if comp else None,
        "splitSuggestion": comp.split_suggestion if comp else None,
        "notes": notes,
        "warnings": warnings,
    }


def run_estimate(plan: Plan, sources: Sources, page_ids: list[str] | None, level: str | None,
                 workdir: Path, progress=None) -> dict:
    """Estimate for selected pages at a level (page scope) or the whole plan (file scope)."""
    from pdftool.core.plan import LEVELS

    workdir.mkdir(parents=True, exist_ok=True)
    if page_ids is not None:
        chosen = [p for p in plan.pages if p.id in set(page_ids)]
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

    overrides = page_overrides(plan)
    fs = resolve_file(plan.fileCompression)
    groups: dict[ImageSettings, list[int]] = {}
    free = [i for i in all_pages if i not in overrides]
    for i, s in overrides.items():
        groups.setdefault(s, []).append(i)
    est = sum(estimate.estimate(assembled, sizes, pages, s, workdir) for s, pages in groups.items())
    result = {"originalBytes": original}
    if fs is None:
        est += sum(sizes[i] for i in free)
    elif fs.use_ghostscript:
        raw, packed = workdir / "gs-raw.pdf", workdir / "gs-packed.pdf"
        sample = estimate.sample_indices(sizes, all_pages)
        estimate.extract(assembled, sample, raw)
        compressor.ghostscript(raw, packed, fs.image)
        ratio = min(packed.stat().st_size / max(raw.stat().st_size, 1), 1.0)
        est = int(ratio * original)
    elif fs.target_bytes is not None:
        budget = TARGET_BUDGET * fs.target_bytes - est
        chosen = LADDER[-1]
        for s in LADDER:
            e = estimate.estimate(assembled, sizes, free, s, workdir)
            if e <= budget:
                chosen, free_est = s, e
                break
        else:
            free_est = estimate.estimate(assembled, sizes, free, chosen, workdir)
        est += free_est
        result["level"] = {"maxDpi": chosen.max_dpi, "quality": chosen.quality}
        result["targetMet"] = est <= fs.target_bytes
    else:
        est += estimate.estimate(assembled, sizes, free, fs.image, workdir)
    result["estimatedBytes"] = int(est)
    return result
