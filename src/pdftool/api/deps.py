from fastapi import Request

from pdftool.core.documents import Registry
from pdftool.jobs import JobManager


def registry(request: Request) -> Registry:
    return request.app.state.registry


def jobs(request: Request) -> JobManager:
    return request.app.state.jobs
