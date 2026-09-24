/**
 * Instant client-side size estimator (spec §4.3/§11.2).
 *
 * Pure functions only: no React, no IO. Mirrors `src/pdftool/core/profile.py`
 * (`resolve_file`, `target_ladder`, `page_overrides`, `estimate_outcome`) so the browser and
 * the backend agree. A shared `estimate.vectors.json` is asserted from both sides.
 */
import type { FileCompression, Level, PageKind, Plan, PlanPage, Profile } from "../api/types";

export const MB = 1_000_000;
export const EMAIL_TARGET_MB = 20;
export const TARGET_BUDGET = 0.9;

export interface ImageSettings {
  maxDpi: number;
  quality: number;
  grayscaleScans: boolean;
}

export const LEVELS: Record<Level, ImageSettings> = {
  light: { maxDpi: 200, quality: 85, grayscaleScans: false },
  medium: { maxDpi: 150, quality: 75, grayscaleScans: false },
  strong: { maxDpi: 100, quality: 60, grayscaleScans: true },
};

export const PRESETS: Record<string, ImageSettings> = {
  high: LEVELS.light,
  balanced: LEVELS.medium,
  zalo: { maxDpi: 120, quality: 70, grayscaleScans: false },
};

export const LADDER: ImageSettings[] = [
  [200, 85], [150, 75], [120, 70], [100, 60], [85, 55], [72, 50],
].map(([maxDpi, quality]) => ({ maxDpi, quality, grayscaleScans: false }));

export function settingsKey(settings: ImageSettings): string {
  return `${settings.maxDpi}-${settings.quality}-${settings.grayscaleScans ? 1 : 0}`;
}

export function pageGroup(kind: string, maxDpi: number): string {
  if (kind === "vector") return "vector";
  const band = maxDpi > 300 ? "hi" : maxDpi > 150 ? "mid" : "lo";
  return `${kind}:${band}`;
}

export interface FileSettings {
  image: ImageSettings | null;
  targetBytes: number | null;
  useGhostscript: boolean;
  stripMetadata: boolean;
  grayscaleScans: boolean | null;
}

/** TS mirror of `plan.resolve_file`. */
export function resolveFile(fc: FileCompression | null | undefined): FileSettings | null {
  if (!fc) return null;
  const adv = fc.advanced ?? {};
  const manual = adv.maxDpi != null || adv.jpegQuality != null;
  let targetMb = fc.targetMB != null ? fc.targetMB : fc.preset === "email" ? EMAIL_TARGET_MB : null;
  if (manual) targetMb = null; // manual DPI/JPEG disables target mode
  const base = PRESETS[fc.preset ?? ""] ?? LEVELS.medium;
  let image: ImageSettings | null = null;
  if (targetMb == null) {
    image = {
      maxDpi: adv.maxDpi ?? base.maxDpi,
      quality: adv.jpegQuality ?? base.quality,
      grayscaleScans: adv.grayscaleScans != null ? adv.grayscaleScans : base.grayscaleScans,
    };
  }
  return {
    image,
    targetBytes: targetMb != null ? Math.trunc(targetMb * MB) : null,
    useGhostscript: !!adv.useGhostscript,
    stripMetadata: !!adv.stripMetadata,
    grayscaleScans: adv.grayscaleScans != null ? adv.grayscaleScans : null,
  };
}

/** TS mirror of `plan.target_ladder`: an explicit grayscale choice applies to every rung. */
export function targetLadder(fs: FileSettings): ImageSettings[] {
  if (fs.grayscaleScans == null) return LADDER;
  return LADDER.map((rung) => ({ ...rung, grayscaleScans: fs.grayscaleScans as boolean }));
}

/** TS mirror of `plan.page_overrides`: per-page levels by plan position. */
export function pageOverrides(plan: Plan): Map<number, ImageSettings> {
  const overrides = new Map<number, ImageSettings>();
  plan.pages.forEach((page, i) => {
    if (page.compress) overrides.set(i, LEVELS[page.compress]);
  });
  return overrides;
}

export interface PageStat {
  size: number;
  kind: PageKind;
  maxDpi: number;
}

/** The only part of the analysis report the estimator reads. */
export interface ReportStat {
  pagesDetail: PageStat[];
}

export interface EstimateInput {
  plan: Plan;
  reports: Record<string, ReportStat>;
  profiles: Record<string, Profile>;
  /** What-if override for a preset card; absent = use the plan's file compression. */
  fileCompression?: FileCompression | null;
  /** Set together with `level` for page scope. */
  pageIds?: string[];
  level?: Level;
}

export type UnsupportedReason = "manual" | "ghostscript" | "image-page" | "no-profile" | "no-report";

export type EstimateOutcome =
  | {
      kind: "ok";
      originalBytes: number;
      estimatedBytes: number;
      level?: { maxDpi: number; quality: number };
      targetMet?: boolean;
    }
  | { kind: "unsupported"; reason: UnsupportedReason };

function ratio(profiles: Record<string, Profile>, docId: string, group: string, settings: ImageSettings): number {
  const found = profiles[docId]?.ratios?.[group]?.[settingsKey(settings)];
  return found ?? 1;
}

function pageReason(
  page: PlanPage,
  reports: Record<string, ReportStat>,
  profiles: Record<string, Profile>,
): UnsupportedReason | null {
  const source = page.source;
  if (source.type === "image") return "image-page";
  if (source.type === "blank") return null;
  if (!reports[source.docId]) return "no-report";
  if (!profiles[source.docId]) return "no-profile";
  return null;
}

interface PageEntry {
  doc: string;
  size: number;
  group: string;
  override: ImageSettings | null;
}

function pageBytes(report: ReportStat, index: number): { size: number; group: string } {
  const page = report.pagesDetail[index];
  return { size: Math.trunc(page.size), group: pageGroup(page.kind, page.maxDpi) };
}

export function estimatePlan(input: EstimateInput): EstimateOutcome {
  const plan = input.plan;
  const reports = input.reports ?? {};
  const profiles = input.profiles ?? {};
  const fc = Object.prototype.hasOwnProperty.call(input, "fileCompression")
    ? input.fileCompression ?? null
    : plan.fileCompression;
  const pageIds = input.pageIds;
  const level = input.level;

  if (pageIds != null && level != null && LEVELS[level]) {
    const ids = new Set(pageIds);
    const selected = plan.pages.filter((p) => ids.has(p.id));
    for (const page of selected) {
      const reason = pageReason(page, reports, profiles);
      if (reason) return { kind: "unsupported", reason };
    }
    const settings = LEVELS[level];
    let original = 0;
    let estimated = 0;
    for (const page of selected) {
      if (page.source.type !== "pdf") continue;
      const { size, group } = pageBytes(reports[page.source.docId], page.source.index);
      original += size;
      estimated += size * ratio(profiles, page.source.docId, group, settings);
    }
    return { kind: "ok", originalBytes: original, estimatedBytes: Math.round(estimated) };
  }

  if (fc) {
    const adv = fc.advanced ?? {};
    if (adv.maxDpi != null || adv.jpegQuality != null) return { kind: "unsupported", reason: "manual" };
    if (adv.useGhostscript) return { kind: "unsupported", reason: "ghostscript" };
  }
  for (const page of plan.pages) {
    const reason = pageReason(page, reports, profiles);
    if (reason) return { kind: "unsupported", reason };
  }

  const fs = resolveFile(fc);
  const overrides = pageOverrides(plan);
  let original = 0;
  const entries: PageEntry[] = plan.pages.map((page, pos) => {
    const override = overrides.get(pos) ?? null;
    if (page.source.type !== "pdf") return { doc: "", size: 0, group: "", override };
    const { size, group } = pageBytes(reports[page.source.docId], page.source.index);
    original += size;
    return { doc: page.source.docId, size, group, override };
  });

  if (fs && fs.targetBytes != null) {
    let fixed = 0;
    const free: PageEntry[] = [];
    for (const entry of entries) {
      if (entry.override) fixed += entry.size * ratio(profiles, entry.doc, entry.group, entry.override);
      else free.push(entry);
    }
    const budget = TARGET_BUDGET * fs.targetBytes - fixed;
    const ladder = targetLadder(fs);
    let chosen = ladder[ladder.length - 1];
    for (const rung of ladder) {
      const estimate = free.reduce((sum, e) => sum + e.size * ratio(profiles, e.doc, e.group, rung), 0);
      if (estimate <= budget) {
        chosen = rung;
        break;
      }
    }
    const freeBytes = free.reduce((sum, e) => sum + e.size * ratio(profiles, e.doc, e.group, chosen), 0);
    const estimated = fixed + freeBytes;
    return {
      kind: "ok",
      originalBytes: original,
      estimatedBytes: Math.round(estimated),
      level: { maxDpi: chosen.maxDpi, quality: chosen.quality },
      targetMet: estimated <= fs.targetBytes,
    };
  }

  const base = fs ? fs.image : null;
  let estimated = 0;
  for (const entry of entries) {
    const settings = entry.override ?? base;
    estimated += settings ? entry.size * ratio(profiles, entry.doc, entry.group, settings) : entry.size;
  }
  return { kind: "ok", originalBytes: original, estimatedBytes: Math.round(estimated) };
}
