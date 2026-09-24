"""Size estimation by compressing a sample of pages (spec §4.6).

The sample mixes the heaviest pages with pages spread over the rest. The two
groups usually compress very differently (e.g. a few 600 DPI scans among many
already-small pages), so each group gets its own ratio: the heavy ratio is
applied to the heavy pages' bytes and the spread ratio to everything else.
Ratios are measured per page (same accounting as `inspect.page_sizes`) on one
raw sample file and its compressed copy, so a single extract + optimize gives
both ratios and file-level overhead does not skew them.
"""
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import pikepdf
import pymupdf

from pdftool.core import compressor, inspect
from pdftool.core.plan import ImageSettings

SAMPLE_PAGES = 12


def _split_sample(sizes: list[int], candidates: list[int], limit: int = SAMPLE_PAGES) -> tuple[list[int], list[int]]:
    """(heavy, spread): half the heaviest pages, half spread evenly over the rest."""
    if len(candidates) <= limit:
        return list(candidates), []
    heavy = sorted(candidates, key=lambda i: -sizes[i])[: limit // 2]
    heavy_set = set(heavy)
    rest = [i for i in candidates if i not in heavy_set]
    want = limit - len(heavy)
    step = len(rest) / want
    spread = sorted({rest[int(k * step)] for k in range(want)})
    return sorted(heavy), spread


def sample_indices(sizes: list[int], candidates: list[int], limit: int = SAMPLE_PAGES) -> list[int]:
    """Up to `limit` pages: half the heaviest, half spread evenly over the rest."""
    heavy, spread = _split_sample(sizes, candidates, limit)
    return sorted(set(heavy) | set(spread))


def measure_sizes(path: Path) -> list[int]:
    with pymupdf.open(path) as fdoc, pikepdf.open(path) as pdf:
        return inspect.page_sizes(fdoc, pdf)


def extract(src: Path, indices: list[int], out: Path) -> None:
    """Copy the given pages into a new file, dropping resources those pages don't use."""
    with pikepdf.open(src) as pdf, pikepdf.new() as new:
        for i in indices:
            new.pages.append(pdf.pages[i])
        # Pages sharing one big /Resources dict would otherwise drag every
        # image of the source into the sample.
        new.remove_unreferenced_resources()
        new.save(out)


def _ratio(packed: int, raw: int) -> float:
    return min(packed / raw, 1.0) if raw > 0 else 1.0


@dataclass
class Sample:
    """A raw sample of `pages` extracted once, reusable for several settings."""
    src: Path
    raw: Path
    workdir: Path
    heavy_pos: list[int]      # positions in the sample file
    spread_pos: list[int]
    heavy_bytes: int          # source bytes of the heavy pages
    rest_bytes: int           # source bytes of every other page in `pages`
    raw_sizes: list[int]
    _cache: dict = field(default_factory=dict)

    def group_ratios(self, key, run) -> tuple[float, float]:
        """(heavy, spread) ratios after `run(raw, out)` rewrites the sample; cached by `key`."""
        if key not in self._cache:
            packed = self.raw.with_name(self.raw.stem.replace("sample-raw-", "sample-packed-", 1) + ".pdf")
            try:
                run(self.raw, packed)
                psizes = measure_sizes(packed)
            finally:
                packed.unlink(missing_ok=True)
            heavy = _ratio(sum(psizes[p] for p in self.heavy_pos), sum(self.raw_sizes[p] for p in self.heavy_pos))
            spread = (
                _ratio(sum(psizes[p] for p in self.spread_pos), sum(self.raw_sizes[p] for p in self.spread_pos))
                if self.spread_pos else heavy
            )
            self._cache[key] = (heavy, spread)
        return self._cache[key]

    def ratios(self, settings: ImageSettings) -> tuple[float, float]:
        return self.group_ratios(
            settings, lambda raw, out: compressor.optimize(raw, out, [settings] * len(self.raw_sizes))
        )

    def apply(self, ratios: tuple[float, float]) -> int:
        heavy, spread = ratios
        return int(heavy * self.heavy_bytes + spread * self.rest_bytes)

    def estimate(self, settings: ImageSettings) -> int:
        return self.apply(self.ratios(settings))

    def close(self) -> None:
        """Remove the raw sample file (cached ratios stay usable)."""
        self.raw.unlink(missing_ok=True)


def prepare(src: Path, sizes: list[int], pages: list[int], workdir: Path) -> Sample | None:
    """Extract the sample for `pages` once. None when there are no pages."""
    if not pages:
        return None
    heavy, spread = _split_sample(sizes, pages)
    order = sorted(set(heavy) | set(spread))
    pos = {page: k for k, page in enumerate(order)}
    fd, name = tempfile.mkstemp(prefix="sample-raw-", suffix=".pdf", dir=workdir)
    os.close(fd)
    raw = Path(name)
    extract(src, order, raw)
    heavy_bytes = sum(sizes[i] for i in heavy)
    return Sample(
        src=src, raw=raw, workdir=workdir,
        heavy_pos=[pos[i] for i in heavy], spread_pos=[pos[i] for i in spread],
        heavy_bytes=heavy_bytes, rest_bytes=sum(sizes[i] for i in pages) - heavy_bytes,
        raw_sizes=measure_sizes(raw),
    )


def estimate(src: Path, sizes: list[int], pages: list[int], settings: ImageSettings, workdir: Path) -> int:
    """Estimated compressed bytes of `pages` of src."""
    sample = prepare(src, sizes, pages, workdir)
    if sample is None:
        return 0
    try:
        return sample.estimate(settings)
    finally:
        sample.close()
