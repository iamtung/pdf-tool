import type { Advanced, DocInfo, FileCompression, Plan, Preset, SplitOption } from "../api/types";

/** The part of the plan an export covers: all pages, or only `onlyIds` (in plan order). */
export function subsetPlan(plan: Plan, onlyIds?: string[]): Plan {
  if (!onlyIds) return plan;
  const keep = new Set(onlyIds);
  return { pages: plan.pages.filter((p) => keep.has(p.id)), fileCompression: plan.fileCompression };
}

/**
 * Mirrors backend `parse_ranges`: comma-separated "a" or "a-b" chunks, 1 <= a <= b <= n,
 * at least one range. Returns 0-based page index lists, or a user-facing error.
 */
export function parseRanges(text: string, n: number): { ranges: number[][] } | { error: string } {
  if (n < 1) return { error: "Không có trang nào để tách." };
  const ranges: number[][] = [];
  for (const chunk of text.split(",").map((c) => c.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(chunk);
    if (!m) return { error: `Khoảng trang không hợp lệ: "${chunk}". Nhập dạng 1-10, 11-${n}.` };
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    if (a > b) return { error: `Khoảng "${chunk}": trang đầu phải nhỏ hơn hoặc bằng trang cuối.` };
    if (a < 1 || b > n) return { error: `Khoảng "${chunk}" nằm ngoài 1–${n}.` };
    ranges.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  if (!ranges.length) return { error: `Chưa nhập khoảng trang (ví dụ 1-${n}).` };
  return { ranges };
}

/** True when every page 1..n appears in some range (invalid input counts as not covering). */
export function coversAllPages(ranges: string, n: number): boolean {
  const r = parseRanges(ranges, n);
  if ("error" in r) return false;
  const seen = new Set(r.ranges.flat());
  return seen.size === n;
}

/** An export that wrote every page of the editor plan, so the document can be marked saved. */
export function isFullExport(onlyIds: string[] | undefined, split: SplitOption | null | undefined, n: number): boolean {
  if (onlyIds) return false;
  if (split?.mode === "ranges") return coversAllPages(split.ranges, n);
  return true; // no split, or a size split (covers everything)
}

/** Before/after compare only makes sense for a single output whose pages match the plan 1:1. */
export function canCompare(outputCount: number, split: SplitOption | null | undefined): boolean {
  return outputCount === 1 && split?.mode !== "ranges";
}

/** Same rule as the backend: folder of the doc of the first PDF page, Downloads for uploads/no PDF. */
export function defaultDestination(plan: Plan, docs: Record<string, DocInfo>): string {
  const first = plan.pages.find((p) => p.source.type === "pdf");
  const doc = first && first.source.type === "pdf" ? docs[first.source.docId] : undefined;
  if (!doc || doc.uploaded) return "~/Downloads";
  const dir = doc.path.replace(/\/[^/]*$/, "");
  return dir || "/";
}

export interface CompressionInput {
  preset: Preset | null;
  target: string;
  adv: Advanced;
}

export type CompressionErrors = Partial<Record<"target" | "maxDpi" | "jpegQuality", string>>;

const intIn = (v: number | null | undefined, lo: number, hi: number) =>
  v == null || (Number.isInteger(v) && v >= lo && v <= hi);

export function isManual(adv: Advanced): boolean {
  return adv.maxDpi != null || adv.jpegQuality != null;
}

/** Validate the compress dialog; mirrors backend FileCompression/Advanced field constraints. */
export function validateCompression({ target, adv }: CompressionInput): CompressionErrors {
  const errors: CompressionErrors = {};
  if (!isManual(adv) && target.trim() && !(Number(target) > 0)) errors.target = "Dung lượng mục tiêu phải lớn hơn 0.";
  if (!intIn(adv.maxDpi, 36, 1200)) errors.maxDpi = "DPI tối đa là số nguyên từ 36 đến 1200.";
  if (!intIn(adv.jpegQuality, 10, 100)) errors.jpegQuality = "Chất lượng JPEG là số nguyên từ 10 đến 100.";
  return errors;
}

/** Preset actually in effect: none when a target is set, else the chosen one or "balanced". */
export function effectivePreset({ preset, target, adv }: CompressionInput): Preset | null {
  const hasTarget = !isManual(adv) && target.trim() !== "";
  return hasTarget ? null : preset ?? "balanced";
}

/** Build the FileCompression to apply, or null while the input is invalid. */
export function buildFileCompression(input: CompressionInput): FileCompression | null {
  if (Object.keys(validateCompression(input)).length) return null;
  const manual = isManual(input.adv);
  const targetMB = !manual && input.target.trim() ? Number(input.target) : null;
  return { preset: effectivePreset(input), targetMB, advanced: input.adv };
}
