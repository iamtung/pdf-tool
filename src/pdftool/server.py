import contextlib
import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException

from pdftool.api import docs, jobs, system, work
from pdftool.core.documents import Registry
from pdftool.core.errors import PdfToolError
from pdftool.jobs import JobManager

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"

# Spec §8: the server only listens on 127.0.0.1. Host checks stop DNS rebinding; Origin
# checks stop cross-site requests from other pages the user has open.
ALLOWED_HOSTS = {"127.0.0.1", "localhost"}
# Vite dev server; trusted only when PDFTOOL_DEV=1 (set by the CLI --dev flag).
DEV_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
UPLOAD_PATH = "/api/docs/upload"


def _error(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"code": code, "message": message}, status_code=status)


class LocalGuardMiddleware:
    """Host allowlist (DNS rebinding), Origin check (CSRF) and content-type check for /api."""

    def __init__(self, app, allowed_hosts=ALLOWED_HOSTS, dev_origins=()):
        self.app = app
        self.allowed_hosts = set(allowed_hosts)
        self.dev_origins = set(dev_origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        response = self._check(scope)
        if response is not None:
            return await response(scope, receive, send)
        await self.app(scope, receive, send)

    def _check(self, scope) -> JSONResponse | None:
        headers = Headers(scope=scope)
        host = headers.get("host", "")
        hostname = urlsplit(f"//{host}").hostname if host else None
        if hostname not in self.allowed_hosts:
            return _error("bad_request", "Host không hợp lệ.", 400)

        path = scope.get("path", "")
        # Browsers label requests from other sites; block them even for GETs (e.g. an
        # <img>/fetch from a web page probing or triggering work on the local API).
        if (path == "/api" or path.startswith("/api/")) and headers.get("sec-fetch-site") == "cross-site":
            return _error("forbidden", "Yêu cầu từ nguồn khác bị từ chối.", 403)

        method = scope.get("method", "GET")
        if method in SAFE_METHODS:
            return None
        origin = headers.get("origin")
        if origin is not None and origin not in self.dev_origins and urlsplit(origin).netloc.lower() != host.lower():
            return _error("forbidden", "Yêu cầu từ nguồn khác bị từ chối.", 403)

        if path.startswith("/api/") and method in ("POST", "PUT", "PATCH"):
            ctype = headers.get("content-type", "").split(";")[0].strip().lower()
            has_body = headers.get("content-length", "0") != "0" or "transfer-encoding" in headers
            if path == UPLOAD_PATH:
                if ctype != "multipart/form-data":
                    return _error("bad_request", "Cần gửi file dạng multipart/form-data.", 415)
            elif has_body and ctype != "application/json":
                return _error("bad_request", "Nội dung yêu cầu phải là JSON.", 415)
        return None


def _validation_message(e: RequestValidationError) -> str:
    errs = e.errors()
    if not errs:
        return "Yêu cầu không hợp lệ."
    first = errs[0]
    loc = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
    return f"Yêu cầu không hợp lệ: {loc + ': ' if loc else ''}{first.get('msg', '')}"


def create_app() -> FastAPI:
    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.jobs.sweep_stale()
        yield
        app.state.jobs.shutdown()

    app = FastAPI(title="pdftool", lifespan=lifespan)
    app.state.registry = Registry()
    app.state.jobs = JobManager()
    dev = os.environ.get("PDFTOOL_DEV") == "1"
    app.add_middleware(LocalGuardMiddleware, dev_origins=DEV_ORIGINS if dev else ())

    @app.exception_handler(PdfToolError)
    async def _pdftool_error(_: Request, e: PdfToolError):
        return _error(e.code, e.message, e.http_status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, e: RequestValidationError):
        return _error("bad_request", _validation_message(e), 400)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, e: StarletteHTTPException):
        code = {404: "not_found", 403: "forbidden"}.get(e.status_code)
        if code is None:
            code = "internal" if e.status_code >= 500 else "bad_request"
        message = e.detail if isinstance(e.detail, str) else "Yêu cầu không hợp lệ."
        if e.status_code == 404:
            message = "Không tìm thấy."
        return _error(code, message, e.status_code)

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, e: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _error("internal", "Lỗi không mong muốn.", 500)

    for r in (docs.router, work.router, jobs.router, system.router):
        app.include_router(r)

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   include_in_schema=False)
    def api_not_found(path: str):
        raise PdfToolError("not_found", "Không tìm thấy API.")

    if (STATIC / "index.html").exists():
        static_root = STATIC.resolve()
        index = static_root / "index.html"
        app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path == "api" or path.startswith("api/"):
                raise PdfToolError("not_found", "Không tìm thấy API.")
            if path:
                f = (static_root / path).resolve()
                if f.is_relative_to(static_root) and f.is_file():
                    return FileResponse(f)
            return FileResponse(index)

    return app
