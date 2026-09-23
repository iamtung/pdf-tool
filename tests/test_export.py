import errno

import pikepdf
import pymupdf
import pytest

from pdftool.core import compressor, export as export_mod
from pdftool.core.errors import PdfToolError
from pdftool.core.export import (
    DEST_MANIFEST, ExportOptions, atomic_write, cleanup_dest_tmp, group_by_size, parse_ranges, run_estimate,
    run_export,
)
from pdftool.core.plan import Plan
from tests.fixtures.make import jpeg_bytes

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


# ---------------------------------------------------------------- mixed-DPI fixtures

PAGE_PT = (144, 180)  # small pages keep the fixtures (and every optimize pass) cheap


def image_pages_pdf(path, pixel_sizes, title=None):
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


@pytest.fixture(scope="module")
def heavy_light(tmp_path_factory):
    """6 heavy 600 DPI pages among 60 light 120 DPI pages (a single sample ratio got this ~5x too low)."""
    spec = [HEAVY] * 3 + [LIGHT] * 30 + [HEAVY] * 3 + [LIGHT] * 30
    return image_pages_pdf(tmp_path_factory.mktemp("hl") / "hl.pdf", spec)


@pytest.fixture
def tiny(tmp_path):
    return image_pages_pdf(tmp_path / "tiny.pdf", [HEAVY, LIGHT])


def test_estimate_accurate_on_mixed_dpi(heavy_light, out_dir, tmp_path):
    fc = {"preset": "balanced"}
    est = run_estimate(plan_for(66, fc=fc), {"a": {"path": str(heavy_light)}}, None, None, tmp_path / "w")
    actual = export(plan_for(66, fc=fc), heavy_light, out_dir, tmp_path)["resultSize"]
    assert abs(est["estimatedBytes"] - actual) <= 0.35 * actual


def test_target_on_mixed_dpi_met_without_ghostscript(heavy_light, out_dir, tmp_path, monkeypatch):
    # Target sits between the 85/55 and 100/60 rungs: a too-low estimate used to pick a light
    # rung, step down twice and give up (then fall back to Ghostscript).
    from pdftool.core.plan import LADDER
    probe = tmp_path / "probe.pdf"
    compressor.optimize(heavy_light, probe, [LADDER[4]] * 66)
    target_mb = probe.stat().st_size * 1.6 / MB

    passes = []
    real_optimize = compressor.optimize

    def counting_optimize(i, o, *a, **k):
        if "sample" not in o.name:
            passes.append(o.name)
        return real_optimize(i, o, *a, **k)

    def no_gs(*a, **k):
        raise AssertionError("Ghostscript must not be needed")

    monkeypatch.setattr(compressor, "optimize", counting_optimize)
    monkeypatch.setattr(compressor, "ghostscript", no_gs)
    r = export(plan_for(66, fc={"targetMB": target_mb}), heavy_light, out_dir, tmp_path)
    assert r["targetMet"] is True
    assert r["resultSize"] <= target_mb * MB
    assert len(passes) <= 2


def test_ghostscript_failure_keeps_ladder_result(tiny, out_dir, tmp_path, monkeypatch):
    def broken_gs(*a, **k):
        raise PdfToolError("internal", "Ghostscript lỗi: boom")

    monkeypatch.setattr(compressor, "ghostscript_available", lambda: True)
    monkeypatch.setattr(compressor, "ghostscript", broken_gs)
    r = export(plan_for(2, fc={"targetMB": 0.001}), tiny, out_dir, tmp_path)
    assert r["compressed"] is True
    assert r["level"] == {"maxDpi": 72, "quality": 50}  # the whole ladder ran before Ghostscript
    assert r["targetMet"] is False and r["splitSuggestion"] >= 2
    assert "Ghostscript lỗi, giữ kết quả nén thường." in r["notes"]
    assert pymupdf.open(r["outputs"][0]["path"]).page_count == 2


def _has_metadata(path):
    with pikepdf.open(path) as pdf:
        return "/Title" in pdf.docinfo or "/Metadata" in pdf.Root


def test_strip_metadata_when_baseline_wins(tmp_path, out_dir):
    src = tmp_path / "titled.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Only vector text")
    doc.set_metadata({"title": "Secret title"})
    doc.set_xml_metadata("<x:xmpmeta xmlns:x='adobe:ns:meta/'></x:xmpmeta>")
    doc.save(src)
    assert _has_metadata(src)
    fc = {"preset": "balanced", "advanced": {"stripMetadata": True}}
    r = export(plan_for(1, fc=fc), src, out_dir, tmp_path)
    assert r["alreadyOptimal"] is True
    assert r["outputs"][0]["name"] == "doc_edited.pdf"
    assert r["level"] is None and r["targetMet"] is None and r["splitSuggestion"] is None
    assert not _has_metadata(r["outputs"][0]["path"])


def test_strip_metadata_on_compressed_and_split_output(tiny, tmp_path, out_dir):
    src = image_pages_pdf(tmp_path / "titled.pdf", [HEAVY, LIGHT], title="Secret title")
    fc = {"preset": "balanced", "advanced": {"stripMetadata": True}}
    r = export(plan_for(2, fc=fc), src, out_dir, tmp_path, split={"mode": "ranges", "ranges": "1,2"})
    assert r["compressed"] is True
    assert all(not _has_metadata(o["path"]) for o in r["outputs"])


@pytest.mark.skipif(not compressor.ghostscript_available(), reason="needs Ghostscript")
def test_ghostscript_with_target_reports_target_and_strips(tmp_path, out_dir):
    src = image_pages_pdf(tmp_path / "titled.pdf", [HEAVY, LIGHT], title="Secret title")
    fc = {"targetMB": 0.001, "advanced": {"useGhostscript": True, "stripMetadata": True}}
    r = export(plan_for(2, fc=fc), src, out_dir, tmp_path)
    assert r["targetMet"] is False and r["splitSuggestion"] >= 2
    assert not _has_metadata(r["outputs"][0]["path"])


def test_already_optimal_with_target_reports_written_file(vector3, out_dir, tmp_path):
    r = export(plan_for(3, fc={"targetMB": 50}), vector3, out_dir, tmp_path)
    assert r["alreadyOptimal"] is True
    assert r["outputs"][0]["name"] == "doc_edited.pdf" and r["level"] is None
    assert r["targetMet"] is True and r["splitSuggestion"] is None


@pytest.mark.parametrize("split", [
    {"mode": "size"}, {"mode": "size", "maxMB": 0}, {"mode": "size", "maxMB": -3},
    {"mode": "size", "maxMB": "abc"}, {"mode": "ranges", "ranges": "1-9"}, {"mode": "ranges"},
    {"mode": "pages"},
])
def test_bad_split_rejected_before_work(split, vector3, out_dir, tmp_path, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("heavy work started before validation")

    monkeypatch.setattr(export_mod, "assemble", boom)
    monkeypatch.setattr(export_mod, "compress", boom)
    with pytest.raises(PdfToolError) as e:
        export(plan_for(3), vector3, out_dir, tmp_path, split=split)
    assert e.value.code == "bad_request"


def test_estimate_page_scope_requires_level(vector3, tmp_path):
    with pytest.raises(PdfToolError) as e:
        run_estimate(plan_for(3), {"a": {"path": str(vector3)}}, ["p0"], None, tmp_path / "w")
    assert e.value.code == "bad_request"


def test_disk_full_during_export(vector3, out_dir, tmp_path, monkeypatch):
    def full(*a, **k):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(export_mod, "assemble", full)
    with pytest.raises(PdfToolError) as e:
        export(plan_for(3), vector3, out_dir, tmp_path)
    assert e.value.code == "disk_full"


def test_workdir_free_space_checked(vector3, out_dir, tmp_path, monkeypatch):
    real = export_mod.shutil.disk_usage
    work = tmp_path / "work"

    def usage(path):
        u = real(path)
        return u._replace(free=0) if export_mod.Path(path) == work else u

    monkeypatch.setattr(export_mod.shutil, "disk_usage", usage)
    with pytest.raises(PdfToolError) as e:
        export(plan_for(3), vector3, out_dir, tmp_path)
    assert e.value.code == "disk_full"


def test_cleanup_dest_tmp_removes_listed_files(tmp_path):
    work, dest = tmp_path / "work", tmp_path / "dest"
    work.mkdir(), dest.mkdir()
    listed = [dest / "doc.1a2b3c4d.tmp.pdf", dest / "doc_part2.deadbeef.tmp.pdf"]
    for p in listed:
        p.write_bytes(b"partial")
    keep = dest / "doc.pdf"
    keep.write_bytes(b"user")
    missing = dest / "gone.00000000.tmp.pdf"
    (work / DEST_MANIFEST).write_text("".join(f"{p}\n" for p in [*listed, missing, keep]))
    removed = cleanup_dest_tmp(work)
    assert sorted(removed) == sorted(listed)
    assert not any(p.exists() for p in listed)
    assert keep.read_bytes() == b"user"  # not a tmp name: never deleted
    assert not (work / DEST_MANIFEST).exists()
    assert cleanup_dest_tmp(work) == []


def test_export_records_and_clears_dest_manifest(vector3, out_dir, tmp_path, monkeypatch):
    seen = []
    real = export_mod._publish

    def spy(tmp, dest_dir, stem):
        seen.append((tmp, (tmp_path / "work" / DEST_MANIFEST).read_text()))
        return real(tmp, dest_dir, stem)

    monkeypatch.setattr(export_mod, "_publish", spy)
    export(plan_for(3), vector3, out_dir, tmp_path, split={"mode": "ranges", "ranges": "1,2-3"})
    assert len(seen) == 2 and all(str(tmp) in text for tmp, text in seen)
    assert not (tmp_path / "work" / DEST_MANIFEST).exists()


def test_atomic_write_never_touches_existing_files(vector3, tmp_path, monkeypatch):
    dest = tmp_path / "dest"
    dest.mkdir()
    lookalike = dest / "doc.aaaaaaaa.tmp.pdf"
    lookalike.write_bytes(b"USER TMP")
    legacy = dest / "doc.tmp.pdf"
    legacy.write_bytes(b"USER LEGACY")
    existing = dest / "doc.pdf"
    existing.write_bytes(b"USER FINAL")
    hexes = iter(["aaaaaaaa", "bbbbbbbb"])
    monkeypatch.setattr(export_mod.secrets, "token_hex", lambda n: next(hexes))

    # Simulate a file appearing at the chosen final name between the check and the rename.
    real_unique = export_mod.unique_path
    raced = dest / "doc (2).pdf"
    calls = []

    def racy_unique(d, stem):
        p = real_unique(d, stem)
        if not calls:
            raced.write_bytes(b"USER RACED")
        calls.append(p)
        return p

    monkeypatch.setattr(export_mod, "unique_path", racy_unique)
    final = atomic_write(vector3, dest, "doc", 3)
    assert final.name == "doc (3).pdf"
    assert pymupdf.open(final).page_count == 3
    assert lookalike.read_bytes() == b"USER TMP"
    assert legacy.read_bytes() == b"USER LEGACY"
    assert existing.read_bytes() == b"USER FINAL"
    assert raced.read_bytes() == b"USER RACED"
    assert not (dest / "doc.bbbbbbbb.tmp.pdf").exists()


def test_atomic_write_bad_file_leaves_nothing(vector3, tmp_path):
    dest = tmp_path / "dest"
    dest.mkdir()
    with pytest.raises(PdfToolError):
        atomic_write(vector3, dest, "doc", 99)
    assert list(dest.iterdir()) == []
