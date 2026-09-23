import pytest

from tests.fixtures import make


@pytest.fixture(autouse=True)
def pdftool_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("PDFTOOL_HOME", str(home))
    return home


# Expensive fixtures are built once per session. Tests must treat them as read-only.
@pytest.fixture(scope="session")
def mixed(tmp_path_factory):
    return make.mixed_pdf(tmp_path_factory.mktemp("fx") / "mixed.pdf")


@pytest.fixture(scope="session")
def scans(tmp_path_factory):
    return make.scans_pdf(tmp_path_factory.mktemp("fx") / "scans.pdf", pages=4, dpi=400)


@pytest.fixture
def vector3(tmp_path):
    return make.vector_pdf(tmp_path / "vector.pdf", 3)


@pytest.fixture
def encrypted(tmp_path):
    return make.encrypted_pdf(tmp_path / "locked.pdf")


@pytest.fixture
def corrupted(tmp_path):
    return make.corrupted_pdf(tmp_path / "broken.pdf")


@pytest.fixture
def jpg(tmp_path):
    return make.image_file(tmp_path / "photo.jpg")
