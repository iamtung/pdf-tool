import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import type { EstimateResult, JobState, Level, Plan, Profile, Report, Source } from "./types";

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
export async function waitJob<R>(
  jobId: string, onProgress?: (j: JobState<R>) => void, signal?: AbortSignal,
): Promise<JobState<R>> {
  for (;;) {
    signal?.throwIfAborted();
    const job = await api.job<R>(jobId);
    signal?.throwIfAborted();
    onProgress?.(job);
    if (TERMINAL_STATUSES.includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** The analysis job itself failed or was cancelled: retrying would only start a new job. */
export class JobFailedError extends Error {}

/** Fetch the analysis report, waiting (by polling) for the background job on large files. */
async function fetchAnalysis(
  docId: string, onProgress: (j: JobState<unknown>) => void, signal?: AbortSignal,
): Promise<Report> {
  for (let round = 0; round < 3; round++) {
    signal?.throwIfAborted();
    const r = await api.analysis(docId);
    if (r.status === "done") return r.report;
    const job = await waitJob(r.jobId, onProgress, signal);
    if (job.status !== "done") throw new JobFailedError(job.error?.message ?? "Phân tích bị hủy.");
  }
  throw new JobFailedError("Không nhận được kết quả phân tích.");
}

/**
 * Analysis report for a document. One shared query per docId (React Query dedups the
 * promise), so however many components use it there is a single subscription to the job.
 * Progress of the background job is published to the ["analysis-progress", docId] query.
 */
export function useAnalysis(docId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["analysis", docId],
    queryFn: ({ signal }) =>
      fetchAnalysis(docId!, (j) => qc.setQueryData(["analysis-progress", docId], j), signal),
    enabled: !!docId,
    retry: (n, e) => n < 2 && !(e instanceof JobFailedError),
    staleTime: Infinity,
  });
  const progress = useQuery<JobState<unknown> | null>({
    queryKey: ["analysis-progress", docId],
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
  return {
    report: query.data ?? null,
    job: query.data ? null : progress.data ?? null,
    error: query.error ?? null,
  };
}

/** Fetch the compression profile, waiting (by polling) for the background job. */
async function fetchProfile(
  docId: string, onProgress: (j: JobState<unknown>) => void, signal?: AbortSignal,
): Promise<Profile> {
  for (let round = 0; round < 3; round++) {
    signal?.throwIfAborted();
    const r = await api.profile(docId);
    if (r.status === "done") return r.profile;
    const job = await waitJob(r.jobId, onProgress, signal);
    if (job.status !== "done") throw new JobFailedError(job.error?.message ?? "Tính hồ sơ nén bị hủy.");
  }
  throw new JobFailedError("Không nhận được hồ sơ nén.");
}

/**
 * Compression profile for a document. One shared query per docId (React Query dedups the promise).
 * `enabled` should become true once the analysis report exists.
 */
export function useProfile(docId: string | null, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["profile", docId],
    queryFn: ({ signal }) =>
      fetchProfile(docId!, (j) => qc.setQueryData(["profile-progress", docId], j), signal),
    enabled: !!docId && enabled,
    retry: (n, e) => n < 2 && !(e instanceof JobFailedError),
    staleTime: Infinity,
  });
  const progress = useQuery<JobState<unknown> | null>({
    queryKey: ["profile-progress", docId],
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
  return {
    profile: query.data ?? null,
    job: query.data ? null : progress.data ?? null,
    error: query.error ?? null,
  };
}

/** Analysis report + compression profile for the same doc, ready for `estimatePlan`. */
export function useProfileEstimate(docId: string | null) {
  const { report, job: analysisJob, error: analysisError } = useAnalysis(docId);
  const profileState = useProfile(docId, !!report);
  return {
    report,
    profile: profileState.profile,
    job: profileState.job ?? (report ? null : analysisJob),
    error: profileState.error ?? analysisError,
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
  const jobRef = useRef<JobState<EstimateResult> | null>(null);
  useEffect(() => {
    setJobId(null);
    setError(null);
    if (!key || !plan) return;
    let active = true;
    let started: string | null = null;
    const cancel = (id: string) => void api.cancelJob(id).catch(() => {});
    const t = setTimeout(() => {
      api.estimate(plan, pageIds, level)
        .then((r) => {
          if (!active) return cancel(r.jobId); // superseded while the request was in flight
          started = r.jobId;
          setJobId(r.jobId);
        })
        .catch((e) => active && setError(e.message));
    }, delay);
    return () => {
      active = false;
      clearTimeout(t);
      // Superseded or unmounted: stop the server-side job unless it already finished.
      const last = jobRef.current;
      const finished = last?.id === started && TERMINAL_STATUSES.includes(last.status);
      if (started && !finished) cancel(started);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const job = useJob<EstimateResult>(jobId);
  jobRef.current = job;
  return {
    loading: !!key && !error && job?.status !== "done" && job?.status !== "failed",
    result: job?.status === "done" ? job.result : null,
    error: error ?? (job?.status === "failed" ? job.error?.message ?? "Lỗi ước tính" : null),
  };
}
