"""Precomputed compression profile and the client estimator reference (spec §11.2, §4.3).

A profile measures how much each *group* of pages (page kind x DPI band) shrinks under every
compression setting the UI can offer. One optimize run on one raw sample file yields a ratio for
all groups at that setting, so the whole profile costs exactly ``len(profile_settings())`` runs
(12) on at most 14 sample pages.
"""
from dataclasses import replace
from pathlib import Path

from pdftool.core import compressor, documents, estimate
from pdftool.core.export import TARGET_BUDGET
from pdftool.core.plan import (
    LADDER, LEVELS, PRESETS, FileCompression, ImageSettings, Plan, page_overrides, resolve_file,
    target_ladder,
)

PROFILE_VERSION = 1
MAX_SAMPLE_PAGES = 14
MAX_GROUP_SAMPLES = 2


def settings_key(settings: ImageSettings) -> str:
    """Contract §11.2: "<maxDpi>-<quality>-<0|1>" (1 = grayscale scans)."""
    return f"{settings.max_dpi}-{settings.quality}-{1 if settings.grayscale_scans else 0}"


def profile_settings() -> dict[str, ImageSettings]:
    """Every setting the profile must measure, derived from the plan constants exactly once.

    = LEVELS ∪ PRESETS ∪ (LADDER rungs x {grayscale off, on}). The ladder rungs duplicated by
    LEVELS/PRESETS collapse, leaving 12 distinct keys.
    """
    out: dict[str, ImageSettings] = {}
    for settings in (*LEVELS.values(), *PRESETS.values(), *LADDER):
        out[settings_key(settings)] = settings
    for rung in LADDER:
        gray = replace(rung, grayscale_scans=True)
        out[settings_key(gray)] = gray
    return out


def page_group(kind: str, max_dpi: float) -> str:
    """§11.2 group rule: vector is its own group; scan/image_heavy split by DPI band."""
    if kind == "vector":
        return "vector"
    band = "hi" if max_dpi > 300 else "mid" if max_dpi > 150 else "lo"
    return f"{kind}:{band}"


def group_pages(pages: list[dict]) -> dict[str, list[int]]:
    groups: dict[str, list[int]] = {}
    for i, page in enumerate(pages):
        groups.setdefault(page_group(page["kind"], page["maxDpi"]), []).append(i)
    return groups


def _sample_pages(pages: list[dict], group: list[int]) -> list[int]:
    """Up to 2 pages: the heaviest plus one spread evenly over the rest of the group."""
    heaviest = max(group, key=lambda i: pages[i]["size"])
    rest = [i for i in group if i != heaviest]
    if not rest:
        return [heaviest]
    return sorted({heaviest, rest[len(rest) // 2]})


def build_profile(path: Path, password: str | None, report: dict, workdir: Path, progress=None) -> dict:
    """Compute the profile of `report`'s document. `workdir` holds the raw sample file."""
    pages = report["pagesDetail"]
    groups = group_pages(pages)
    samples = {group: _sample_pages(pages, idxs) for group, idxs in groups.items()}
    indices = sorted({i for picks in samples.values() for i in picks})
    workdir.mkdir(parents=True, exist_ok=True)
    raw = workdir / "profile-sample.pdf"
    estimate.extract(path, indices, raw, password)
    raw_sizes = estimate.measure_sizes(raw)
    position = {page_i: k for k, page_i in enumerate(indices)}

    settings = profile_settings()
    ratios: dict[str, dict[str, float]] = {group: {} for group in groups}
    for k, (key, s) in enumerate(settings.items()):
        packed = workdir / f"profile-packed-{key}.pdf"
        try:
            compressor.optimize(raw, packed, [s] * len(indices))
            packed_sizes = estimate.measure_sizes(packed)
        finally:
            packed.unlink(missing_ok=True)
        for group, idxs in groups.items():
            picked = samples[group]
            raw_bytes = sum(raw_sizes[position[i]] for i in picked)
            new_bytes = sum(packed_sizes[position[i]] for i in picked)
            ratios[group][key] = round(min(new_bytes / raw_bytes, 1.0), 4) if raw_bytes > 0 else 1.0
        if progress:
            progress((k + 1) / len(settings), "Đang chuẩn bị ước tính")
    raw.unlink(missing_ok=True)
    return {
        "version": PROFILE_VERSION,
        "settings": {
            key: {"maxDpi": s.max_dpi, "quality": s.quality, "grayscaleScans": s.grayscale_scans}
            for key, s in settings.items()
        },
        "ratios": ratios,
        "pageCount": len(pages),
        "fingerprint": documents.fingerprint(path),
    }


# ------------------------------------------------------------------ client estimator reference

def _unsupported(reason: str) -> dict:
    return {"kind": "unsupported", "reason": reason}


def _ratio(profiles: dict, doc_id: str, group: str, settings: ImageSettings) -> float:
    profile = profiles.get(doc_id)
    if profile is None:
        return 1.0
    return float(profile.get("ratios", {}).get(group, {}).get(settings_key(settings), 1.0))


def _page_reason(page, reports: dict, profiles: dict) -> str | None:
    source = page.source
    if source.type == "image":
        return "image-page"
    if source.type == "blank":
        return None
    if reports.get(source.docId) is None:
        return "no-report"
    if source.docId not in profiles:
        return "no-profile"
    return None


def _page_bytes(source, report: dict) -> tuple[int, str]:
    page = report["pagesDetail"][source.index]
    return int(page["size"]), page_group(page["kind"], page["maxDpi"])


def estimate_outcome(inp: dict) -> dict:
    """Python reference for the TS `estimatePlan` (§4.3), on the same JSON input shape."""
    plan = Plan.model_validate(inp["plan"])
    reports: dict = inp.get("reports") or {}
    profiles: dict = inp.get("profiles") or {}
    fc_raw = inp["fileCompression"] if "fileCompression" in inp else plan.fileCompression
    fc = FileCompression.model_validate(fc_raw) if fc_raw is not None else None
    page_ids = inp.get("pageIds")
    level = inp.get("level")

    if page_ids is not None and level in LEVELS:
        selected = [p for p in plan.pages if p.id in set(page_ids)]
        for page in selected:
            reason = _page_reason(page, reports, profiles)
            if reason:
                return _unsupported(reason)
        settings = LEVELS[level]
        original, estimated = 0, 0.0
        for page in selected:
            if page.source.type == "blank":
                continue
            report = reports[page.source.docId]
            size, group = _page_bytes(page.source, report)
            original += size
            estimated += size * _ratio(profiles, page.source.docId, group, settings)
        return {"kind": "ok", "originalBytes": original, "estimatedBytes": int(round(estimated))}

    if fc is not None and (fc.advanced.maxDpi is not None or fc.advanced.jpegQuality is not None):
        return _unsupported("manual")
    if fc is not None and fc.advanced.useGhostscript:
        return _unsupported("ghostscript")
    for page in plan.pages:
        reason = _page_reason(page, reports, profiles)
        if reason:
            return _unsupported(reason)

    fs = resolve_file(fc)
    overrides = page_overrides(plan)
    original = 0
    pages: list[tuple[str, int, str, ImageSettings | None]] = []
    for pos, page in enumerate(plan.pages):
        override = overrides.get(pos)
        if page.source.type == "blank":
            pages.append(("", 0, "", override))
            continue
        report = reports[page.source.docId]
        size, group = _page_bytes(page.source, report)
        original += size
        pages.append((page.source.docId, size, group, override))

    if fs is not None and fs.target_bytes is not None:
        fixed = sum(
            size * _ratio(profiles, doc, group, override)
            for doc, size, group, override in pages if override is not None
        )
        budget = TARGET_BUDGET * fs.target_bytes - fixed
        ladder = target_ladder(fs)
        chosen = ladder[-1]
        for rung in ladder:
            free = sum(
                size * _ratio(profiles, doc, group, rung)
                for doc, size, group, override in pages if override is None
            )
            if free <= budget:
                chosen = rung
                break
        free = sum(
            size * _ratio(profiles, doc, group, chosen)
            for doc, size, group, override in pages if override is None
        )
        estimated = fixed + free
        return {
            "kind": "ok",
            "originalBytes": original,
            "estimatedBytes": int(round(estimated)),
            "level": {"maxDpi": chosen.max_dpi, "quality": chosen.quality},
            "targetMet": estimated <= fs.target_bytes,
        }

    base = fs.image if fs is not None else None
    estimated = 0.0
    for doc, size, group, override in pages:
        settings = override if override is not None else base
        if settings is None:
            estimated += size
        else:
            estimated += size * _ratio(profiles, doc, group, settings)
    return {"kind": "ok", "originalBytes": original, "estimatedBytes": int(round(estimated))}
