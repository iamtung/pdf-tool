import os

import pytest

from pdftool.core.documents import Registry, fingerprint
from pdftool.core.errors import PdfToolError


def test_open_returns_document_with_metadata(mixed):
    reg = Registry()
    doc = reg.open(mixed)
    assert doc.page_count == 5
    assert doc.size == mixed.stat().st_size
    assert doc.path == mixed and not doc.repaired and not doc.uploaded
    assert reg.get(doc.id) is doc


def test_missing_file_is_not_found(tmp_path):
    with pytest.raises(PdfToolError) as e:
        Registry().open(tmp_path / "nope.pdf")
    assert e.value.code == "not_found"


def test_encrypted_requires_password(encrypted):
    reg = Registry()
    with pytest.raises(PdfToolError) as e:
        reg.open(encrypted)
    assert e.value.code == "password_required"
    with pytest.raises(PdfToolError) as e:
        reg.open(encrypted, "wrong")
    assert e.value.code == "wrong_password"
    assert reg.open(encrypted, "secret").page_count == 2


def test_corrupted_file(corrupted):
    with pytest.raises(PdfToolError) as e:
        Registry().open(corrupted)
    assert e.value.code == "corrupted"


def test_changed_file_detected(vector3):
    reg = Registry()
    doc = reg.open(vector3)
    st = vector3.stat()
    os.utime(vector3, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    with pytest.raises(PdfToolError) as e:
        reg.get(doc.id)
    assert e.value.code == "file_changed"


def test_fingerprint_changes_with_content(tmp_path):
    a = tmp_path / "a.bin"
    a.write_bytes(b"x" * 10)
    f1 = fingerprint(a)
    a.write_bytes(b"y" * 10)
    assert fingerprint(a) != f1


def test_close_removes(vector3):
    reg = Registry()
    doc = reg.open(vector3)
    reg.close(doc.id)
    with pytest.raises(PdfToolError):
        reg.get(doc.id)


def test_repair_path_used_when_pymupdf_rejects_original(vector3, monkeypatch):
    from pdftool.core import documents

    real_open = documents.open_fitz

    def picky_open(path, password=None):
        if path == vector3:
            raise PdfToolError("corrupted", "simulated")
        return real_open(path, password)

    monkeypatch.setattr(documents, "open_fitz", picky_open)
    reg = Registry()
    doc = reg.open(vector3)
    assert doc.repaired and doc.path != vector3 and doc.path.exists()
    assert doc.page_count == 3
    reg.close(doc.id)
    assert not doc.path.exists()
