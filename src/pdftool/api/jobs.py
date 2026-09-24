import asyncio
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from pdftool.api.deps import jobs
from pdftool.core.errors import PdfToolError
from pdftool.jobs import TERMINAL, Job, JobManager

router = APIRouter(prefix="/api/jobs")


def _get(jm: JobManager, job_id: str) -> Job:
    job = jm.get(job_id)
    if job is None:
        raise PdfToolError("not_found", "Không tìm thấy tác vụ.")
    return job


@router.get("/{job_id}")
def get_job(job_id: str, jm: JobManager = Depends(jobs)) -> dict:
    return _get(jm, job_id).public()


@router.get("/{job_id}/events")
async def events(job_id: str, jm: JobManager = Depends(jobs)) -> StreamingResponse:
    job = _get(jm, job_id)

    async def stream():
        seen = -1
        while True:
            if job.version != seen:
                seen = job.version
                yield f"data: {json.dumps(job.public())}\n\n"
                if job.status in TERMINAL:
                    return
            await asyncio.sleep(0.2)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.delete("/{job_id}")
def cancel(job_id: str, jm: JobManager = Depends(jobs)) -> dict:
    _get(jm, job_id)
    return jm.cancel(job_id).public()
