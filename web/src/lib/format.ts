import type { FileCompression } from "../api/types";

const MB = 1_000_000;

export function formatBytes(n: number): string {
  if (n >= 100 * MB) return `${Math.round(n / MB)} MB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}

export function percent(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)}%` : "0%";
}

const PAPERS: [string, number, number][] = [
  ["A3", 842, 1191], ["A4", 595, 842], ["A5", 420, 595], ["Letter", 612, 792], ["Legal", 612, 1008],
];

/** "A4 dọc", "Letter ngang", or "210×297 mm". */
export function paperName(width: number, height: number): string {
  const [short, long] = width < height ? [width, height] : [height, width];
  const orient = width <= height ? "dọc" : "ngang";
  const match = PAPERS.find(([, w, h]) => Math.abs(w - short) < 4 && Math.abs(h - long) < 4);
  if (match) return `${match[0]} ${orient}`;
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  return `${mm(width)}×${mm(height)} mm`;
}

export const KIND_LABEL = { scan: "Scan", image_heavy: "Nhiều ảnh", vector: "Chữ / vector" } as const;
export const LEVEL_LABEL = { light: "Nhẹ", medium: "Vừa", strong: "Mạnh" } as const;
export const PRESET_LABEL = {
  email: "Email ≤ 20 MB", zalo: "Zalo / Mobile", balanced: "Cân bằng", high: "Chất lượng cao",
} as const;

export function describeFileCompression(fc: FileCompression): string {
  if (fc.advanced?.useGhostscript) return "Ghostscript";
  if (fc.targetMB) return `dưới ${fc.targetMB} MB`;
  if (fc.advanced?.maxDpi || fc.advanced?.jpegQuality) return "Tùy chỉnh";
  return fc.preset ? PRESET_LABEL[fc.preset] : "Cân bằng";
}
