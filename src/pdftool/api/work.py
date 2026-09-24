"""Plan-level endpoints: render plan pages, estimate, export."""
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

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
    width: int = 160


class EstimateRequest(BaseModel):
    plan: Plan
    pageIds: list[str] | None = None  # set -> page scope (needs level); None -> whole plan
    level: Level | None = None


class ExportRequest(BaseModel):
    plan: Plan
    destDir: str | None = None
    baseName: str | None = None
    split: dict | None = None


def sources_for(plan: Plan, reg: Registry) -> dict:
    ids = {p.source.docId for p in plan.pages if p.source.type == "pdf"}
    return {d: reg.get(d).source() for d in ids}


@router.post("/render")
def render_source(req: RenderRequest) -> Response:
    if req.source.type == "image" and not Path(req.source.path).is_file():
        raise PdfToolError("not_found", "Không tìm thấy ảnh.")
    return Response(renderer.render_source(req.source.model_dump(), req.width), media_type="image/webp",
                    headers=IMAGE_HEADERS)


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
    base = req.baseName or (primary.original_path.stem if primary else "pages")
    job = jm.submit("export", {
        "plan": req.plan.model_dump(), "sources": sources, "destDir": str(dest), "baseName": base,
        "split": req.split,
    }, exclusive=True)
    return {"jobId": job.id}
