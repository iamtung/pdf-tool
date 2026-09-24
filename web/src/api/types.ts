export type Level = "light" | "medium" | "strong";
export type Preset = "email" | "zalo" | "balanced" | "high";

export type PdfSource = { type: "pdf"; docId: string; index: number };
export type ImageSource = { type: "image"; path: string };
export type BlankSource = { type: "blank"; width: number; height: number };
export type Source = PdfSource | ImageSource | BlankSource;

export interface PlanPage {
  id: string;
  source: Source;
  rotate: number;
  compress: Level | null;
}

export interface Advanced {
  maxDpi?: number | null;
  jpegQuality?: number | null;
  grayscaleScans?: boolean | null;
  stripMetadata?: boolean;
  useGhostscript?: boolean;
}

export interface FileCompression {
  preset?: Preset | null;
  targetMB?: number | null;
  advanced?: Advanced;
}

export interface Plan {
  pages: PlanPage[];
  fileCompression: FileCompression | null;
}

export interface PageDims {
  width: number;
  height: number;
  rotation: number;
}

export interface DocInfo {
  docId: string;
  name: string;
  path: string;
  uploaded: boolean;
  repaired: boolean;
  size: number;
  pageCount: number;
  version: string | null;
  encrypted: boolean;
  producer: string | null;
  creator: string | null;
  pages: PageDims[];
}

export type PageKind = "scan" | "image_heavy" | "vector";

export interface PageDetail {
  index: number;
  size: number;
  kind: PageKind;
  width: number;
  height: number;
  imageCount: number;
  maxDpi: number;
  fontCount: number;
  images: number[];
  placements: { xref: number; bbox: [number, number, number, number] }[];
  heavy: boolean;
}

export interface ImageDetail {
  xref: number;
  width: number;
  height: number;
  dpi: number;
  filter: string | null;
  colorspace: string | null;
  size: number;
  pages: number[];
}

export interface Report {
  size: number;
  pageCount: number;
  composition: { images: number; fonts: number; content: number; other: number };
  pagesDetail: PageDetail[];
  kinds: Partial<Record<PageKind, number>>;
  topImages: ImageDetail[];
  images: Record<string, ImageDetail>;
  suggestions: string[];
}

export type AnalysisResponse =
  | { status: "done"; report: Report }
  | { status: "running"; jobId: string };

export interface ProfileSetting {
  maxDpi: number;
  quality: number;
  grayscaleScans: boolean;
}

/** Precomputed per-group compression ratios (spec §11.2). */
export interface Profile {
  version: number;
  settings: Record<string, ProfileSetting>;
  ratios: Record<string, Record<string, number>>;
  pageCount: number;
  fingerprint: string;
}

export type ProfileResponse =
  | { status: "done"; profile: Profile }
  | { status: "running"; jobId: string };

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobState<R = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  progress: number;
  message: string;
  result: R | null;
  error: { code: string; message: string } | null;
}

export interface EstimateResult {
  originalBytes: number;
  estimatedBytes: number;
  level?: { maxDpi: number; quality: number };
  targetMet?: boolean;
}

export type SplitOption = { mode: "ranges"; ranges: string } | { mode: "size"; maxMB: number };

export interface ExportResult {
  outputs: { path: string; size: number; name: string }[];
  originalSize: number;
  resultSize: number;
  compressed: boolean;
  alreadyOptimal: boolean;
  level: { maxDpi: number; quality: number } | null;
  targetMet: boolean | null;
  splitSuggestion: number | null;
  notes: string[];
  warnings: string[];
}

export interface Health {
  ghostscript: boolean;
  gsVersion: string | null;
  freeBytes: number;
  home: string;
}
