import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import type { EstimateResult, JobState, Level, Plan, Source } from "./types";

const TERMINAL_STATUSES = ["done", "failed", "cancelled"];

/** Follow a job over SSE until it finishes; falls back to polling if the stream errors. */
export function useJob<R>(jobId: string | null): JobState<R> | null {
  const [state, setState] = useState<JobState<R> | null>(null);
  const stateRef = useRef<JobState<R> | null>(null);
  stateRef.current = state;
  useEffect(() => {
    setState(null);
    stateRef.current = null;
    if (!jobId) return;
    let cancelled = false;
    const es = new EventSource(`/api/jobs/${jobId}/events`);

    const pollFallback = async () => {
      let failures = 0;
      while (!cancelled) {
        try {
          const job = await api.job<R>(jobId);
          failures = 0;
          if (cancelled) return;
          setState(job);
          if (TERMINAL_STATUSES.includes(job.status)) return;
        } catch {
          failures += 1;
          if (failures >= 3) {
            if (cancelled) return;
            const base: JobState<R> = stateRef.current ?? {
              id: jobId,
              kind: "",
              status: "queued",
              progress: 0,
              message: "",
              result: null,
              error: null,
            };
            setState({
              ...base,
              status: "failed",
              error: { code: "internal", message: "Mất kết nối tới máy chủ." },
            });
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    es.onmessage = (e) => {
      const job = JSON.parse(e.data) as JobState<R>;
      setState(job);
      if (TERMINAL_STATUSES.includes(job.status)) es.close();
    };
    es.onerror = () => {
      es.close();
      void pollFallback();
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [jobId]);
  return state;
}

/** Wait for a job to finish (polling). Used where a promise is more convenient than a hook. */
export async function waitJob<R>(jobId: string, onProgress?: (j: JobState<R>) => void): Promise<JobState<R>> {
  for (;;) {
    const job = await api.job<R>(jobId);
    onProgress?.(job);
    if (["done", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Analysis report for a document; runs the background job for large files. */
export function useAnalysis(docId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["analysis", docId],
    queryFn: () => api.analysis(docId!),
    enabled: !!docId,
    staleTime: Infinity,
  });
  const jobId = query.data?.status === "running" ? query.data.jobId : null;
  const job = useJob(jobId);
  useEffect(() => {
    if (job?.status === "done") qc.invalidateQueries({ queryKey: ["analysis", docId] });
  }, [job?.status, docId, qc]);
  return {
    report: query.data?.status === "done" ? query.data.report : null,
    job,
    error: query.error ?? (job?.status === "failed" ? new Error(job.error?.message) : null),
  };
}

/** Image URL for a plan page thumbnail or large view. */
export function usePageImage(source: Source, width: number, scale?: number): string | null {
  const isPdf = source.type === "pdf";
  const q = useQuery({
    queryKey: ["render-source", source, width],
    queryFn: () => api.renderSource(source as Exclude<Source, { type: "pdf" }>, width),
    enabled: !isPdf,
    staleTime: Infinity,
  });
  if (source.type === "pdf") {
    return scale ? api.renderUrl(source.docId, source.index, scale) : api.thumbUrl(source.docId, source.index, width);
  }
  return q.data ?? null;
}

/** Debounced size estimate. key changes trigger a new job; stale results are discarded. */
export function useEstimate(
  plan: Plan | null, pageIds: string[] | null, level: Level | null, enabled: boolean, delay = 600,
) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = enabled && plan ? JSON.stringify([plan, pageIds, level]) : null;
  const latest = useRef<string | null>(null);
  useEffect(() => {
    latest.current = key;
    setJobId(null);
    setError(null);
    if (!key || !plan) return;
    const t = setTimeout(() => {
      api.estimate(plan, pageIds, level)
        .then((r) => latest.current === key && setJobId(r.jobId))
        .catch((e) => latest.current === key && setError(e.message));
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const job = useJob<EstimateResult>(jobId);
  return {
    loading: !!key && !error && job?.status !== "done" && job?.status !== "failed",
    result: job?.status === "done" ? job.result : null,
    error: error ?? (job?.status === "failed" ? job.error?.message ?? "Lỗi ước tính" : null),
  };
}
