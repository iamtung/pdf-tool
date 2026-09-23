from pdftool.core import analyzer


def test_report_basics(mixed):
    r = analyzer.analyze(mixed)
    assert r["pageCount"] == 5
    assert r["size"] == mixed.stat().st_size
    assert len(r["pages"]) == 5 and r["pages"][0]["width"] == 595


def test_page_kinds(mixed):
    kinds = [p["kind"] for p in analyzer.analyze(mixed)["pagesDetail"]]
    assert kinds == ["scan", "vector", "image_heavy", "image_heavy", "vector"]


def test_composition_mostly_images(mixed):
    r = analyzer.analyze(mixed)
    comp = r["composition"]
    assert comp["images"] / r["size"] > 0.9
    assert sum(comp.values()) >= r["size"] * 0.99


def test_shared_image_split_between_pages(mixed):
    r = analyzer.analyze(mixed)
    p2, p3 = r["pagesDetail"][2], r["pagesDetail"][3]
    assert p2["images"] == p3["images"]
    assert abs(p2["size"] - p3["size"]) < 1000
    shared = r["images"][str(p2["images"][0])]
    assert shared["pages"] == [2, 3]


def test_dpi_and_heavy(mixed):
    r = analyzer.analyze(mixed)
    scan = r["pagesDetail"][0]
    assert 590 <= scan["maxDpi"] <= 610
    assert scan["heavy"] is True
    assert r["pagesDetail"][1]["heavy"] is False


def test_top_images_sorted(mixed):
    top = analyzer.analyze(mixed)["topImages"]
    assert [im["size"] for im in top] == sorted((im["size"] for im in top), reverse=True)
    assert top[0]["filter"] == "DCTDecode"


def test_suggests_scan_downsample(mixed):
    s = analyzer.analyze(mixed)["suggestions"]
    assert any("trang scan" in x for x in s)


def test_progress_called(mixed):
    calls = []
    analyzer.analyze(mixed, progress=lambda f, m: calls.append(f))
    assert calls[-1] == 1.0


def test_placements_have_bbox(mixed):
    p2 = analyzer.analyze(mixed)["pagesDetail"][2]
    assert p2["placements"][0]["bbox"] == [50.0, 100.0, 545.0, 430.0]
