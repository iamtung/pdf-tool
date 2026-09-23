from pdftool import paths
from pdftool.core.errors import PdfToolError


def test_home_respects_env_and_creates_dirs(pdftool_home):
    assert paths.home() == pdftool_home
    for sub in ("cache", "uploads", "tmp"):
        assert (pdftool_home / sub).is_dir()


def test_error_codes_map_to_http_status():
    assert PdfToolError("password_required", "x").http_status == 401
    assert PdfToolError("file_changed", "x").http_status == 409
    assert PdfToolError("something_else", "x").http_status == 500
