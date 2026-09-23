import pymupdf

from pdftool.core.assemble import assemble
from pdftool.core.plan import Plan


def plan_of(pages):
    return Plan(pages=[{"id": f"p{i}", **p} for i, p in enumerate(pages)])


def pdf(doc, index, **kw):
    return {"source": {"type": "pdf", "docId": doc, "index": index}, **kw}


def test_reorder_delete_rotate(mixed, tmp_path):
    out = tmp_path / "out.pdf"
    plan = plan_of([pdf("a", 4), pdf("a", 1, rotate=90), pdf("a", 0)])
    assemble(plan, {"a": {"path": str(mixed)}}, out)
    d = pymupdf.open(out)
    assert d.page_count == 3
    assert "Last page" in d[0].get_text()
    assert "Hello vector" in d[1].get_text()
    assert [p.rotation for p in d] == [0, 90, 0]


def test_shared_image_not_duplicated(mixed, tmp_path):
    out = tmp_path / "out.pdf"
    assemble(plan_of([pdf("a", 3), pdf("a", 2)]), {"a": {"path": str(mixed)}}, out)
    d = pymupdf.open(out)
    assert d[0].get_images()[0][0] == d[1].get_images()[0][0]


def test_blank_image_and_second_source(mixed, vector3, jpg, tmp_path):
    out = tmp_path / "out.pdf"
    plan = plan_of([
        pdf("a", 1),
        {"source": {"type": "blank", "width": 300, "height": 400}},
        {"source": {"type": "image", "path": str(jpg)}},
        pdf("b", 2),
    ])
    assemble(plan, {"a": {"path": str(mixed)}, "b": {"path": str(vector3)}}, out)
    d = pymupdf.open(out)
    assert d.page_count == 4
    assert (d[1].rect.width, d[1].rect.height) == (300, 400)
    assert round(d[2].rect.width) == 288  # 600 px at 150 DPI
    assert len(d[2].get_images()) == 1
    assert "Page 3" in d[3].get_text()


def test_encrypted_source_output_is_unencrypted(encrypted, tmp_path):
    out = tmp_path / "out.pdf"
    assemble(plan_of([pdf("e", 0)]), {"e": {"path": str(encrypted), "password": "secret"}}, out)
    d = pymupdf.open(out)
    assert not d.needs_pass and d.page_count == 1
