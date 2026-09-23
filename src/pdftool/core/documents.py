"""Registry of open documents: docId -> path, password, fingerprint, mtime."""
import hashlib
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import pikepdf
import pymupdf

from pdftool import paths
from pdftool.core.errors import PdfToolError

_CHUNK = 1024 * 1024


def fingerprint(path: Path) -> str:
    """Fast content key: size + first/last 1 MB + mtime."""
    st = path.stat()
    h = hashlib.sha1(f"{st.st_size}:{st.st_mtime_ns}".encode())
    with open(path, "rb") as f:
        h.update(f.read(_CHUNK))
        if st.st_size > _CHUNK:
            f.seek(max(st.st_size - _CHUNK, _CHUNK))
            h.update(f.read(_CHUNK))
    return h.hexdigest()


def open_fitz(path: Path, password: str | None = None) -> pymupdf.Document:
    """Open with PyMuPDF, authenticating if needed. Raises PdfToolError."""
    try:
        doc = pymupdf.open(path)
    except Exception as e:  # pymupdf raises FileDataError and friends
        raise PdfToolError("corrupted", f"Không đọc được file PDF: {e}") from e
    if doc.needs_pass:
        if not password:
            doc.close()
            raise PdfToolError("password_required", "File được bảo vệ bằng mật khẩu.")
        if not doc.authenticate(password):
            doc.close()
            raise PdfToolError("wrong_password", "Mật khẩu không đúng.")
    if doc.page_count == 0:
        doc.close()
        raise PdfToolError("corrupted", "File PDF không có trang nào hoặc đã hỏng.")
    return doc


def open_pike(path: Path, password: str | None = None) -> pikepdf.Pdf:
    try:
        return pikepdf.open(path, password=password or "")
    except pikepdf.PasswordError as e:
        code = "wrong_password" if password else "password_required"
        raise PdfToolError(code, "Mật khẩu không đúng." if password else "File được bảo vệ bằng mật khẩu.") from e
    except pikepdf.PdfError as e:
        raise PdfToolError("corrupted", f"Không đọc được file PDF: {e}") from e


def repair(path: Path, password: str | None = None) -> Path:
    """Rewrite a damaged PDF through qpdf (pikepdf). Returns the repaired copy."""
    out = paths.tmp_dir() / f"repaired-{uuid.uuid4().hex}.pdf"
    with open_pike(path, password) as pdf:
        pdf.save(out)
    return out


@dataclass
class Document:
    id: str
    path: Path            # file actually processed (repaired copy if needed)
    original_path: Path   # file the user opened
    password: str | None
    fingerprint: str
    mtime_ns: int
    size: int
    page_count: int
    uploaded: bool
    repaired: bool
    fitz: pymupdf.Document = field(repr=False)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def source(self) -> dict:
        """What a worker process needs to reopen this document."""
        return {"path": str(self.path), "password": self.password}


class Registry:
    def __init__(self):
        self._docs: dict[str, Document] = {}
        self._lock = threading.Lock()

    def open(self, path: str | Path, password: str | None = None) -> Document:
        original = Path(path).expanduser()
        if not original.is_file():
            raise PdfToolError("not_found", f"Không tìm thấy file: {original}")
        work, repaired = original, False
        try:
            fdoc = open_fitz(original, password)
        except PdfToolError as e:
            if e.code != "corrupted":
                raise
            try:
                work, repaired = repair(original, password), True
            except PdfToolError:
                raise e from None
            fdoc = open_fitz(work, password)
        st = original.stat()
        doc = Document(
            id=uuid.uuid4().hex[:12],
            path=work,
            original_path=original,
            password=password,
            fingerprint=fingerprint(original),
            mtime_ns=st.st_mtime_ns,
            size=st.st_size,
            page_count=fdoc.page_count,
            uploaded=paths.uploads_dir().resolve() in original.resolve().parents,
            repaired=repaired,
            fitz=fdoc,
        )
        with self._lock:
            self._docs[doc.id] = doc
        return doc

    def get(self, doc_id: str) -> Document:
        doc = self._docs.get(doc_id)
        if doc is None:
            raise PdfToolError("not_found", "Tài liệu chưa được mở hoặc đã đóng.")
        try:
            changed = doc.original_path.stat().st_mtime_ns != doc.mtime_ns
        except FileNotFoundError:
            changed = True
        if changed:
            raise PdfToolError("file_changed", "File gốc đã bị thay đổi hoặc di chuyển. Hãy mở lại.")
        return doc

    def close(self, doc_id: str) -> None:
        with self._lock:
            doc = self._docs.pop(doc_id, None)
        if doc:
            doc.fitz.close()
            if doc.repaired:
                doc.path.unlink(missing_ok=True)

    def all(self) -> list[Document]:
        return list(self._docs.values())
