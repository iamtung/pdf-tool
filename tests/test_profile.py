"""Compression profile (§11.2) and the client estimator reference (§4.3)."""
from dataclasses import replace
from pathlib import Path
from typing import NamedTuple

import pytest

from pdftool.core import compressor, documents, profile
from pdftool.core.analyzer import analyze
from pdftool.core.export import ExportOptions, run_export
from pdftool.core.plan import LADDER, LEVELS, PRESETS, Plan
from tests.fixtures.make import HEAVY, LIGHT, image_pages_pdf

MB = 1_000_000


class Ctx(NamedTuple):
    src: Path
    report: dict
    profile: dict
    calls: list[int]


def plan_for(n, doc="a", fc=None, levels=None):
    levels = levels or [None] * n
    return Plan(
        pages=[{"id": f"p{i}", "source": {"type": "pdf", "docId": doc, "index": i}, "compress": levels[i]}
               for i in range(n)],
        fileCompression=fc,
    )


def _build(path: Path, tmp_path_factory) -> Ctx:
    """Profile `path` once, recording the sample size of every optimize call."""
    patrol = pytest.MonkeyPatch()
    calls: list[int] = []
    real_optimize = compressor.optimize

    def counting(in_path, out_path, page_settings, **kw):
        calls.append(len(page_settings))
        return real_optimize(in_path, out_path, page_settings, **kw)

    patrol.setattr(compressor, "optimize", counting)
    try:
        report = analyze(path)
        prof = profile.build_profile(path, None, report, tmp_path_factory.mktemp(path.stem))
    finally:
        patrol.undo()
    return Ctx(path, report, prof, calls)


@pytest.fixture
def out_dir(tmp_path):
    return tmp_path / "out"


@pytest.fixture(scope="module")
def mixed_ctx(mixed, tmp_path_factory):
    return _build(mixed, tmp_path_factory)


@pytest.fixture(scope="module")
def heavy_light(tmp_path_factory):
    spec = [HEAVY] * 3 + [LIGHT] * 30 + [HEAVY] * 3 + [LIGHT] * 30
    return image_pages_pdf(tmp_path_factory.mktemp("hl") / "hl.pdf", spec)


@pytest.fixture(scope="module")
def heavy_light_ctx(heavy_light, tmp_path_factory):
    return _build(heavy_light, tmp_path_factory)


@pytest.fixture(scope="module")
def scans_ctx(scans, tmp_path_factory):
    return _build(scans, tmp_path_factory)


def test_profile_settings_cover_levels_presets_and_ladder():
    settings = profile.profile_settings()
    assert len(settings) == 12
    for level in LEVELS.values():
        assert profile.settings_key(level) in settings
    for preset in PRESETS.values():
        assert profile.settings_key(preset) in settings
    for rung in LADDER:
        assert profile.settings_key(rung) in settings
        assert profile.settings_key(replace(rung, grayscale_scans=True)) in settings
    for key, value in settings.items():
        assert key == f"{value.max_dpi}-{value.quality}-{1 if value.grayscale_scans else 0}"


def test_page_group_bands():
    assert profile.page_group("scan", 150) == "scan:lo"
    assert profile.page_group("scan", 151) == "scan:mid"
    assert profile.page_group("scan", 300) == "scan:mid"
    assert profile.page_group("scan", 301) == "scan:hi"
    assert profile.page_group("image_heavy", 500) == "image_heavy:hi"
    assert profile.page_group("vector", 9999) == "vector"


def test_build_profile_shape_and_bounds(mixed_ctx):
    src, report, prof, calls = mixed_ctx
    assert set(prof) == {"version", "settings", "ratios", "pageCount", "fingerprint"}
    assert prof["version"] == 1
    assert prof["pageCount"] == report["pageCount"]
    assert prof["fingerprint"] == documents.fingerprint(src)
    expected_groups = set(profile.group_pages(report["pagesDetail"]))
    assert set(prof["ratios"]) == expected_groups
    assert len(prof["ratios"]) >= 3  # mixed: scan, image_heavy and vector
    keys = set(profile.profile_settings())
    for ratios in prof["ratios"].values():
        assert set(ratios) == keys
        assert all(0 < ratio <= 1 for ratio in ratios.values())
    assert len(calls) == 12
    assert max(calls) <= 14 and calls[0] >= 1


def test_heavier_settings_compress_more(scans_ctx):
    ratios = scans_ctx.profile["ratios"]["scan:hi"]
    assert ratios["72-50-0"] <= ratios["150-75-0"] <= ratios["200-85-0"]


def test_grayscale_variant_not_larger(scans_ctx):
    ratios = scans_ctx.profile["ratios"]["scan:hi"]
    assert ratios["150-75-1"] <= ratios["150-75-0"] * 1.01


@pytest.mark.parametrize("case", ["balanced", "zalo", "high", "target"])
@pytest.mark.parametrize("fixture", ["mixed_ctx", "heavy_light_ctx"])
def test_profile_estimate_within_35_percent_of_real_export(case, fixture, request, out_dir, tmp_path):
    ctx = request.getfixturevalue(fixture)
    n = ctx.report["pageCount"]
    fc = {"targetMB": ctx.src.stat().st_size / MB / 8} if case == "target" else {"preset": case}
    plan = plan_for(n, fc=fc)
    inp = {"plan": plan.model_dump(), "reports": {"a": ctx.report}, "profiles": {"a": ctx.profile}}
    estimate = profile.estimate_outcome(inp)
    assert estimate["kind"] == "ok"
    result = run_export(plan, {"a": {"path": str(ctx.src)}}, ExportOptions(out_dir, "doc"), tmp_path / "work")
    actual = result["resultSize"]
    assert abs(estimate["estimatedBytes"] - actual) <= 0.35 * actual


def test_vector_only_document(vector3, tmp_path):
    report = analyze(vector3)
    prof = profile.build_profile(vector3, None, report, tmp_path)
    assert set(prof["ratios"]) == {"vector"}
    n = report["pageCount"]
    base = {"reports": {"a": report}, "profiles": {"a": prof}}

    plain = profile.estimate_outcome({"plan": plan_for(n).model_dump(), **base})
    assert plain["kind"] == "ok"
    assert plain["estimatedBytes"] == plain["originalBytes"]

    compressed = profile.estimate_outcome({"plan": plan_for(n, fc={"preset": "high"}).model_dump(), **base})
    assert compressed["kind"] == "ok"
    assert compressed["estimatedBytes"] <= compressed["originalBytes"]
    assert compressed["estimatedBytes"] >= compressed["originalBytes"] * 0.5
