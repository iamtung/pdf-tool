import pytest
from pydantic import ValidationError

from pdftool.core.plan import (
    LEVELS, Advanced, FileCompression, ImageSettings, Plan, apply_file_compression,
    lightest, page_overrides, resolve_file,
)


def make_plan(levels):
    return Plan(pages=[
        {"id": f"p{i}", "source": {"type": "pdf", "docId": "d", "index": i}, "compress": lv}
        for i, lv in enumerate(levels)
    ])


def test_sources_discriminated():
    p = Plan(pages=[
        {"id": "a", "source": {"type": "blank", "width": 595, "height": 842}},
        {"id": "b", "source": {"type": "image", "path": "/x.jpg"}, "rotate": 450},
    ])
    assert p.pages[0].source.type == "blank"
    assert p.pages[1].rotate == 90


def test_rotate_must_be_multiple_of_90():
    with pytest.raises(ValidationError):
        make_plan([None]).pages[0].model_validate({"id": "x", "source": {"type": "blank", "width": 1, "height": 1}, "rotate": 45})


def test_apply_file_compression_clears_page_levels():
    plan, cleared = apply_file_compression(make_plan(["light", None, "strong"]), FileCompression(preset="balanced"))
    assert cleared == 2
    assert [p.compress for p in plan.pages] == [None, None, None]
    assert plan.fileCompression.preset == "balanced"


def test_page_level_set_after_file_compression_wins():
    plan, _ = apply_file_compression(make_plan([None, None]), FileCompression(preset="zalo"))
    plan.pages[1].compress = "strong"
    assert page_overrides(plan) == {1: LEVELS["strong"]}


def test_resolve_presets():
    assert resolve_file(None) is None
    assert resolve_file(FileCompression(preset="zalo")).image == ImageSettings(120, 70)
    email = resolve_file(FileCompression(preset="email"))
    assert email.image is None and email.target_bytes == 20_000_000
    assert resolve_file(FileCompression(targetMB=8)).target_bytes == 8_000_000


def test_advanced_overrides_preset_and_disables_target():
    fs = resolve_file(FileCompression(preset="email", advanced=Advanced(maxDpi=90)))
    assert fs.target_bytes is None
    assert fs.image == ImageSettings(90, 75)
    fs = resolve_file(FileCompression(preset="high", advanced=Advanced(jpegQuality=50, grayscaleScans=True)))
    assert fs.image == ImageSettings(200, 50, True)


def test_lightest_prefers_higher_dpi():
    assert lightest([LEVELS["strong"], LEVELS["light"], LEVELS["medium"]]) == LEVELS["light"]
