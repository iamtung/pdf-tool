import re
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from pdftool import analysis_cache, paths, profile_cache
from pdftool.api.deps import jobs, registry
from pdftool.core import analyzer, renderer
from pdftool.core.documents import Document, Registry
from pdftool.jobs import JobManager

router = APIRouter(prefix="/api/docs")

SYNC_ANALYSIS_MAX_BYTES = 50_000_000
SYNC_ANALYSIS_MAX_PAGES = 200
IMAGE_HEADERS = {"Cache-Control": "private, max-age=3600"}


MAX_NAME_BYTES = 200  # APFS allows 255; leave room for suffixes like "_compressed (2).<hex>.tmp"


def truncate_utf8(s: str, max_bytes: int) -> str:
    """Cut `s` to at most `max_bytes` UTF-8 bytes without splitting a character."""
    return s.encode()[:max(0, max_bytes)].decode(errors="ignore")


class OpenRequest(BaseModel):
    path: str
    password: str | None = None


def doc_info(doc: Document) -> dict:
    with doc.use() as fdoc:
        ov = analyzer.overview(fdoc, doc.path)
    return {
        "docId": doc.id,
        "name": doc.original_path.name,
        "path": str(doc.original_path),
        "uploaded": doc.uploaded,
        "repaired": doc.repaired,
        **ov,
        "size": doc.size,
    }


@router.post("/open")
def open_doc(req: OpenRequest, reg: Registry = Depends(registry)) -> dict:
    return doc_info(reg.open(req.path, req.password))


@router.post("/upload")
def upload(file: UploadFile = File(...)) -> dict:
    name = re.sub(r"[/\\:\x00]", "_", file.filename or "").strip()
    if name in ("", ".", ".."):
        name = "upload.pdf"
    stem, dot, ext = name.rpartition(".")
    if not stem or len(ext.encode()) > 20:  # no usable extension -> truncate the whole name
        stem, dot, ext = name, "", ""
    name = truncate_utf8(stem, MAX_NAME_BYTES - len((dot + ext).encode())) + dot + ext
    dest_dir = paths.uploads_dir() / uuid.uuid4().hex[:12]
    dest_dir.mkdir(parents=True)
    dest = dest_dir / name
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out, length=8 * 1024 * 1024)
    return {"path": str(dest)}


@router.get("/{doc_id}/analysis")
def analysis(doc_id: str, reg: Registry = Depends(registry), jm: JobManager = Depends(jobs)):
    doc = reg.get(doc_id)
    cached = analysis_cache.load(doc.fingerprint)
    if cached is not None:
        return {"status": "done", "report": cached}
    if doc.size <= SYNC_ANALYSIS_MAX_BYTES and doc.page_count <= SYNC_ANALYSIS_MAX_PAGES:
        report = analyzer.analyze(doc.path, doc.password)
        analysis_cache.save(doc.fingerprint, report)
        return {"status": "done", "report": report}
    job = jm.find_active("analysis", doc.fingerprint) or jm.submit(
        "analysis", {**doc.source(), "fingerprint": doc.fingerprint}, key=doc.fingerprint
    )
    return JSONResponse({"status": "running", "jobId": job.id}, status_code=202)


@router.get("/{doc_id}/profile")
def profile(doc_id: str, reg: Registry = Depends(registry), jm: JobManager = Depends(jobs)) -> dict:
    doc = reg.get(doc_id)
    cached = profile_cache.load(doc.fingerprint)
    if cached is not None:
        return {"status": "done", "profile": cached}
    job = jm.find_active("profile", doc.fingerprint) or jm.submit(
        "profile", {**doc.source(), "fingerprint": doc.fingerprint}, key=doc.fingerprint
    )
    return JSONResponse({"status": "running", "jobId": job.id}, status_code=202)


@router.get("/{doc_id}/pages/{index}/thumb")
def thumb(doc_id: str, index: int, w: int = Query(160, ge=16, le=800), reg: Registry = Depends(registry)) -> Response:
    doc = reg.get(doc_id)
    _check_index(doc, index)
    with doc.use() as fdoc:
        data = renderer.thumbnail(fdoc, doc.fingerprint, index, w)
    return Response(data, media_type="image/webp", headers=IMAGE_HEADERS)


@router.get("/{doc_id}/pages/{index}/render")
def render(doc_id: str, index: int, scale: float = Query(1.5, gt=0, le=8), reg: Registry = Depends(registry)) -> Response:
    doc = reg.get(doc_id)
    _check_index(doc, index)
    with doc.use() as fdoc:
        data = renderer.render(fdoc, doc.fingerprint, index, scale)
    return Response(data, media_type="image/webp", headers=IMAGE_HEADERS)


@router.delete("/{doc_id}")
def close(doc_id: str, reg: Registry = Depends(registry)) -> dict:
    reg.close(doc_id)
    return {"ok": True}


def _check_index(doc: Document, index: int) -> None:
    from pdftool.core.errors import PdfToolError

    if not 0 <= index < doc.page_count:
        raise PdfToolError("not_found", f"Trang {index + 1} không tồn tại.")


def default_destination(doc: Document) -> Path:
    if doc.uploaded:
        return Path.home() / "Downloads"
    return doc.original_path.parent
