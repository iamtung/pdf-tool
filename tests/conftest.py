import pytest


@pytest.fixture(autouse=True)
def pdftool_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("PDFTOOL_HOME", str(home))
    return home
