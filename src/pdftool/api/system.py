import shutil
import subprocess
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from pdftool import macos, paths
from pdftool.core.errors import PdfToolError

router = APIRouter(prefix="/api/system")


class PickRequest(BaseModel):
    kind: Literal["pdf", "image"] = "pdf"
    multiple: bool = False


class RevealRequest(BaseModel):
    path: str


@router.get("/health")
def health() -> dict:
    gs = shutil.which("gs")
    version = None
    if gs:
        version = subprocess.run([gs, "--version"], capture_output=True, text=True).stdout.strip() or None
    return {
        "ghostscript": gs is not None,
        "gsVersion": version,
        "freeBytes": shutil.disk_usage(paths.home()).free,
        "home": str(paths.home()),
    }


@router.post("/pick-file")
def pick_file(req: PickRequest) -> dict:
    return {"paths": macos.pick_files(req.kind, req.multiple)}


@router.post("/pick-folder")
def pick_folder() -> dict:
    return {"path": macos.pick_folder()}


@router.post("/reveal")
def reveal(req: RevealRequest) -> dict:
    if not Path(req.path).exists():
        raise PdfToolError("not_found", "File không còn tồn tại.")
    macos.reveal(req.path)
    return {"ok": True}
