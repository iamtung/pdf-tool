import pymupdf
import pytest

from pdftool.core.errors import PdfToolError
from pdftool.core.export import ExportOptions, group_by_size, parse_ranges, run_estimate, run_export
from pdftool.core.plan import Plan

MB = 1_000_000


def plan_for(n, doc="a", levels=None, fc=None):
    levels = levels or [None] * n
    return Plan(
        pages=[{"id": f"p{i}", "source": {"type": "pdf", "docId": doc, "index": i}, "compress": levels[i]} for i in range(n)],
        fileCompression=fc,
    )


@pytest.fixture
def out_dir(tmp_path):
    return tmp_path / "out"


def export(plan, src, out_dir, tmp_path, split=None, name="doc"):
    return run_export(plan, {"a": {"path": str(src)}}, ExportOptions(out_dir, name, split), tmp_path / "work")


def test_edit_only_named_edited(vector3, out_dir, tmp_path):
    r = export(plan_for(2), vector3, out_dir, tmp_path)
    assert [o["name"] for o in r["outputs"]] == ["doc_edited.pdf"]
    assert pymupdf.open(r["outputs"][0]["path"]).page_count == 2
    assert r["compressed"] is False
    assert not list(out_dir.glob("*.tmp.pdf"))


def test_name_collision_adds_suffix(vector3, out_dir, tmp_path):
    export(plan_for(1), vector3, out_dir, tmp_path)
    r = export(plan_for(1), vector3, out_dir, tmp_path)
    assert r["outputs"][0]["name"] == "doc_edited (2).pdf"


def test_per_page_and_file_compression(mixed, out_dir, tmp_path):
    r = export(plan_for(5, levels=["medium", None, None, None, None]), mixed, out_dir, tmp_path)
    assert r["outputs"][0]["name"] == "doc_compressed.pdf"
    assert r["resultSize"] < r["originalSize"] * 0.8
    r2 = export(plan_for(5, fc={"preset": "balanced"}), mixed, out_dir, tmp_path)
    assert r2["resultSize"] < r["resultSize"]
    assert r2["level"] == {"maxDpi": 150, "quality": 75}


def test_already_optimal(vector3, out_dir, tmp_path):
    r = export(plan_for(3, fc={"preset": "balanced"}), vector3, out_dir, tmp_path)
    assert r["alreadyOptimal"] is True
    assert "File đã tối ưu" in " ".join(r["notes"])


def test_target_size_met(scans, out_dir, tmp_path):
    target_mb = scans.stat().st_size / MB / 8
    r = export(plan_for(4, fc={"targetMB": target_mb}), scans, out_dir, tmp_path)
    assert r["targetMet"] is True
    assert r["resultSize"] <= target_mb * MB


def test_target_size_impossible_suggests_split(scans, out_dir, tmp_path, monkeypatch):
    from pdftool.core import compressor
    monkeypatch.setattr(compressor, "ghostscript_available", lambda: False)
    r = export(plan_for(4, fc={"targetMB": 0.01}), scans, out_dir, tmp_path)
    assert r["targetMet"] is False
    assert r["splitSuggestion"] >= 2


def test_target_skips_ghostscript_with_page_overrides(scans, out_dir, tmp_path):
    r = export(plan_for(4, levels=["light", None, None, None], fc={"targetMB": 0.01}), scans, out_dir, tmp_path)
    assert any("Bỏ qua Ghostscript" in n for n in r["notes"])


def test_split_ranges(vector3, out_dir, tmp_path):
    r = export(plan_for(3), vector3, out_dir, tmp_path, split={"mode": "ranges", "ranges": "1, 2-3"})
    assert [o["name"] for o in r["outputs"]] == ["doc_edited_part1.pdf", "doc_edited_part2.pdf"]
    assert [pymupdf.open(o["path"]).page_count for o in r["outputs"]] == [1, 2]


def test_split_by_size(scans, out_dir, tmp_path):
    limit_mb = scans.stat().st_size / MB / 2.5
    r = export(plan_for(4), scans, out_dir, tmp_path, split={"mode": "size", "maxMB": limit_mb})
    assert len(r["outputs"]) >= 3
    assert all(o["size"] <= limit_mb * MB for o in r["outputs"])
    assert sum(pymupdf.open(o["path"]).page_count for o in r["outputs"]) == 4


def test_split_single_page_over_limit_warns(scans, out_dir, tmp_path):
    r = export(plan_for(2), scans, out_dir, tmp_path, split={"mode": "size", "maxMB": 0.01})
    assert len(r["outputs"]) == 2
    assert any("lớn hơn giới hạn" in w for w in r["warnings"])


def test_parse_ranges_validation():
    assert parse_ranges("1-2, 4", 5) == [[0, 1], [3]]
    for bad in ("", "0-2", "3-1", "1-9", "abc"):
        with pytest.raises(PdfToolError) as e:
            parse_ranges(bad, 5)
        assert e.value.code == "bad_request"


def test_group_by_size():
    assert group_by_size([40, 40, 40, 10], 100) == [[0, 1], [2, 3]]
    assert group_by_size([500, 10], 100) == [[0], [1]]


def test_estimate_pages_close_to_actual(mixed, out_dir, tmp_path):
    plan = plan_for(5)
    est = run_estimate(plan, {"a": {"path": str(mixed)}}, ["p0"], "medium", tmp_path / "w")
    assert est["estimatedBytes"] < est["originalBytes"]
    actual = export(Plan(pages=[plan.pages[0].model_copy(update={"compress": "medium"})]), mixed, out_dir, tmp_path)
    assert abs(est["estimatedBytes"] - actual["resultSize"]) < actual["resultSize"] * 0.5


def test_estimate_file_target(scans, tmp_path):
    target_mb = scans.stat().st_size / MB / 8
    est = run_estimate(plan_for(4, fc={"targetMB": target_mb}), {"a": {"path": str(scans)}}, None, None, tmp_path / "w")
    assert est["estimatedBytes"] <= target_mb * MB
    assert est["targetMet"] is True and "level" in est
