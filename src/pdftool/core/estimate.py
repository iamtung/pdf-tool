"""Size estimation by compressing a sample of pages (spec §4.6)."""
from pathlib import Path

import pikepdf
import pymupdf

from pdftool.core import compressor, inspect
from pdftool.core.plan import ImageSettings

SAMPLE_PAGES = 12


def sample_indices(sizes: list[int], candidates: list[int], limit: int = SAMPLE_PAGES) -> list[int]:
    """Up to `limit` pages: half the heaviest, half spread evenly over the rest."""
    if len(candidates) <= limit:
        return list(candidates)
    heavy = sorted(candidates, key=lambda i: -sizes[i])[: limit // 2]
    rest = [i for i in candidates if i not in set(heavy)]
    want = limit - len(heavy)
    step = len(rest) / want
    spread = [rest[int(k * step)] for k in range(want)]
    return sorted(set(heavy) | set(spread))


def measure_sizes(path: Path) -> list[int]:
    with pymupdf.open(path) as fdoc, pikepdf.open(path) as pdf:
        return inspect.page_sizes(fdoc, pdf)


def extract(src: Path, indices: list[int], out: Path) -> None:
    with pikepdf.open(src) as pdf, pikepdf.new() as new:
        for i in indices:
            new.pages.append(pdf.pages[i])
        new.save(out)


def compression_ratio(src: Path, indices: list[int], settings: ImageSettings, workdir: Path) -> float:
    """compressed/uncompressed ratio for the given pages of src."""
    raw, packed = workdir / "sample-raw.pdf", workdir / "sample-packed.pdf"
    extract(src, indices, raw)
    compressor.optimize(raw, packed, [settings] * len(indices))
    return min(packed.stat().st_size / max(raw.stat().st_size, 1), 1.0)


def estimate(src: Path, sizes: list[int], pages: list[int], settings: ImageSettings, workdir: Path) -> int:
    """Estimated compressed bytes of `pages` of src."""
    if not pages:
        return 0
    ratio = compression_ratio(src, sample_indices(sizes, pages), settings, workdir)
    return int(ratio * sum(sizes[i] for i in pages))
