"""Plan-level endpoints: render plan pages, estimate, export."""
import re
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from pdftool.api.deps import jobs, registry
from pdftool.api.docs import IMAGE_HEADERS, default_destination
from pdftool.core import renderer
from pdftool.core.documents import Registry
from pdftool.core.errors import PdfToolError
from pdftool.core.plan import BlankSource, ImageSource, Level, Plan
from pdftool.jobs import JobManager

router = APIRouter(prefix="/api")


class RenderRequest(BaseModel):
    source: ImageSource | BlankSource
    width: int = Field(160, ge=16, le=800)


class EstimateRequest(BaseModel):
    plan: Plan
    pageIds: list[str] | None = None  # set -> page scope (needs level); None -> whole plan
    level: Level | None = None


class ExportRequest(BaseModel):
    plan: Plan
    destDir: str | None = None
    baseName: str | None = None
    split: dict | None = None


def safe_base_name(name: str | None) -> str:
    """Make a user-supplied output name safe to use as a filename stem (no path parts)."""
    return re.sub(r"[/\\:\x00]", "_", name or "").lstrip(". \t\r\n").rstrip()


def sources_for(plan: Plan, reg: Registry) -> dict:
    ids = {p.source.docId for p in plan.pages if p.source.type == "pdf"}
    return {d: reg.get(d).source() for d in ids}


@router.post("/render")
def render_source(req: RenderRequest) -> Response:
    if req.source.type == "image" and not Path(req.source.path).is_file():
        raise PdfToolError("not_found", "Không tìm thấy ảnh.")
    try:
        data = renderer.render_source(req.source.model_dump(), req.width)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as e:
        raise PdfToolError("bad_request", "File ảnh không đọc được.") from e
    return Response(data, media_type="image/webp", headers=IMAGE_HEADERS)


@router.post("/estimate")
def estimate(req: EstimateRequest, reg: Registry = Depends(registry), jm: JobManager = Depends(jobs)) -> dict:
    if not req.plan.pages:
        raise PdfToolError("bad_request", "Không có trang nào để ước tính.")
    if req.pageIds is not None and req.level is None:
        raise PdfToolError("bad_request", "Cần chọn mức nén để ước tính.")
    job = jm.submit("estimate", {
        "plan": req.plan.model_dump(), "sources": sources_for(req.plan, reg),
        "pageIds": req.pageIds, "level": req.level,
    })
    return {"jobId": job.id}


@router.post("/export")
def export(req: ExportRequest, reg: Registry = Depends(registry), jm: JobManager = Depends(jobs)) -> dict:
    if not req.plan.pages:
        raise PdfToolError("bad_request", "Không có trang nào để xuất.")
    sources = sources_for(req.plan, reg)
    primary = next((reg.get(p.source.docId) for p in req.plan.pages if p.source.type == "pdf"), None)
    dest = Path(req.destDir) if req.destDir else (default_destination(primary) if primary else Path.home() / "Downloads")
    default = primary.original_path.stem if primary else "pages"
    base = safe_base_name(req.baseName) or safe_base_name(default) or "pages"
    job = jm.submit("export", {
        "plan": req.plan.model_dump(), "sources": sources, "destDir": str(dest), "baseName": base,
        "split": req.split,
    }, exclusive=True)
    return {"jobId": job.id}
