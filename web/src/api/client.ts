import type {
  AnalysisResponse, DocInfo, Health, JobState, Level, Plan, SplitOption, Source,
} from "./types";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let code = "internal";
    let message = `Lỗi ${res.status}`;
    try {
      const data = await res.json();
      code = data.code ?? code;
      message = data.message ?? (typeof data.detail === "string" ? data.detail : message);
    } catch {
      /* not JSON */
    }
    throw new ApiError(code, message, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  openDoc: (path: string, password?: string) =>
    request<DocInfo>("POST", "/api/docs/open", { path, password: password ?? null }),

  async upload(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/docs/upload", { method: "POST", body: form });
    if (!res.ok) throw new ApiError("internal", "Tải file lên thất bại.", res.status);
    return (await res.json()).path as string;
  },

  analysis: (docId: string) => request<AnalysisResponse>("GET", `/api/docs/${docId}/analysis`),
  closeDoc: (docId: string) => request<{ ok: boolean }>("DELETE", `/api/docs/${docId}`),

  thumbUrl: (docId: string, index: number, width = 160) =>
    `/api/docs/${docId}/pages/${index}/thumb?w=${width}`,
  renderUrl: (docId: string, index: number, scale: number) =>
    `/api/docs/${docId}/pages/${index}/render?scale=${scale.toFixed(2)}`,

  async renderSource(source: Exclude<Source, { type: "pdf" }>, width: number): Promise<string> {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, width }),
    });
    if (!res.ok) throw new ApiError("internal", "Không vẽ được trang.", res.status);
    return URL.createObjectURL(await res.blob());
  },

  estimate: (plan: Plan, pageIds: string[] | null, level: Level | null) =>
    request<{ jobId: string }>("POST", "/api/estimate", { plan, pageIds, level }),

  exportPlan: (plan: Plan, opts: { destDir?: string | null; baseName?: string | null; split?: SplitOption | null }) =>
    request<{ jobId: string }>("POST", "/api/export", { plan, ...opts }),

  job: <R>(id: string) => request<JobState<R>>("GET", `/api/jobs/${id}`),
  cancelJob: (id: string) => request<JobState>("DELETE", `/api/jobs/${id}`),

  health: () => request<Health>("GET", "/api/system/health"),
  pickFiles: (kind: "pdf" | "image", multiple = false) =>
    request<{ paths: string[] }>("POST", "/api/system/pick-file", { kind, multiple }),
  pickFolder: () => request<{ path: string | null }>("POST", "/api/system/pick-folder"),
  reveal: (path: string) => request<{ ok: boolean }>("POST", "/api/system/reveal", { path }),
};
