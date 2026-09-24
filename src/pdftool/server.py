import contextlib
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pdftool.api import docs, jobs, system, work
from pdftool.core.documents import Registry
from pdftool.core.errors import PdfToolError
from pdftool.jobs import JobManager

STATIC = Path(__file__).parent / "static"


def create_app() -> FastAPI:
    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.jobs.sweep_stale()
        yield
        app.state.jobs.shutdown()

    app = FastAPI(title="pdftool", lifespan=lifespan)
    app.state.registry = Registry()
    app.state.jobs = JobManager()

    @app.exception_handler(PdfToolError)
    async def _pdftool_error(_: Request, e: PdfToolError):
        return JSONResponse({"code": e.code, "message": e.message}, status_code=e.http_status)

    for r in (docs.router, work.router, jobs.router, system.router):
        app.include_router(r)

    if (STATIC / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            f = STATIC / path
            return FileResponse(f if path and f.is_file() else STATIC / "index.html")

    return app
