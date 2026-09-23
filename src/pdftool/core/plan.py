"""Page plan model and compression-level resolution (spec §4.4, §4.5, §4.6)."""
from dataclasses import dataclass
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, field_validator

Level = Literal["light", "medium", "strong"]
Preset = Literal["email", "zalo", "balanced", "high"]

MB = 1_000_000
EMAIL_TARGET_MB = 20


class PdfSource(BaseModel):
    type: Literal["pdf"] = "pdf"
    docId: str
    index: int = Field(ge=0)


class ImageSource(BaseModel):
    type: Literal["image"] = "image"
    path: str


class BlankSource(BaseModel):
    type: Literal["blank"] = "blank"
    width: float = Field(gt=0)
    height: float = Field(gt=0)


Source = Annotated[Union[PdfSource, ImageSource, BlankSource], Field(discriminator="type")]


class PlanPage(BaseModel):
    id: str
    source: Source
    rotate: int = 0
    compress: Level | None = None

    @field_validator("rotate")
    @classmethod
    def _rotate_multiple_of_90(cls, v: int) -> int:
        if v % 90:
            raise ValueError("rotate must be a multiple of 90")
        return v % 360


class Advanced(BaseModel):
    maxDpi: int | None = Field(default=None, ge=36, le=1200)
    jpegQuality: int | None = Field(default=None, ge=10, le=100)
    grayscaleScans: bool | None = None
    stripMetadata: bool = False
    useGhostscript: bool = False


class FileCompression(BaseModel):
    preset: Preset | None = None
    targetMB: float | None = Field(default=None, gt=0)
    advanced: Advanced = Advanced()


class Plan(BaseModel):
    pages: list[PlanPage]
    fileCompression: FileCompression | None = None


@dataclass(frozen=True)
class ImageSettings:
    max_dpi: int
    quality: int
    grayscale_scans: bool = False

    def lightness(self) -> tuple[int, int]:
        """Higher = lighter compression (keeps more quality)."""
        return (self.max_dpi, self.quality)


LEVELS: dict[str, ImageSettings] = {
    "light": ImageSettings(200, 85),
    "medium": ImageSettings(150, 75),
    "strong": ImageSettings(100, 60, grayscale_scans=True),
}

PRESETS: dict[str, ImageSettings] = {
    "high": LEVELS["light"],
    "balanced": LEVELS["medium"],
    "zalo": ImageSettings(120, 70),
}

LADDER = [ImageSettings(d, q) for d, q in [(200, 85), (150, 75), (120, 70), (100, 60), (85, 55), (72, 50)]]


@dataclass(frozen=True)
class FileSettings:
    """Resolved whole-file compression: either fixed image settings or a target size."""
    image: ImageSettings | None
    target_bytes: int | None
    use_ghostscript: bool
    strip_metadata: bool


def resolve_file(fc: FileCompression | None) -> FileSettings | None:
    if fc is None:
        return None
    adv = fc.advanced
    manual = adv.maxDpi is not None or adv.jpegQuality is not None
    target_mb = fc.targetMB if fc.targetMB is not None else (EMAIL_TARGET_MB if fc.preset == "email" else None)
    if manual:
        target_mb = None  # spec §4.6: manual DPI/JPEG disables target mode
    base = PRESETS.get(fc.preset or "", LEVELS["medium"])
    image = None
    if target_mb is None:
        image = ImageSettings(
            adv.maxDpi or base.max_dpi,
            adv.jpegQuality or base.quality,
            base.grayscale_scans if adv.grayscaleScans is None else adv.grayscaleScans,
        )
    return FileSettings(
        image=image,
        target_bytes=int(target_mb * MB) if target_mb is not None else None,
        use_ghostscript=adv.useGhostscript,
        strip_metadata=adv.stripMetadata,
    )


def page_overrides(plan: Plan) -> dict[int, ImageSettings]:
    """Per-page levels (by plan position). These win over file settings at export (§4.5 rule 2)."""
    return {i: LEVELS[p.compress] for i, p in enumerate(plan.pages) if p.compress}


def apply_file_compression(plan: Plan, fc: FileCompression) -> tuple[Plan, int]:
    """§4.5 rule 1: set file compression and clear every per-page level. Returns (plan, cleared)."""
    cleared = sum(1 for p in plan.pages if p.compress)
    pages = [p.model_copy(update={"compress": None}) for p in plan.pages]
    return Plan(pages=pages, fileCompression=fc), cleared


def lightest(settings: list[ImageSettings]) -> ImageSettings:
    """Shared images use the lightest level among the pages using them (§4.6)."""
    return max(settings, key=ImageSettings.lightness)
