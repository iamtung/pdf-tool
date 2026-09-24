import type { Plan, Profile, Report } from "../api/types";

/** Distinct PDF doc ids referenced by a plan, in first-seen order (blank/image pages ignored). */
export function planDocIds(plan: Plan | null): string[] {
  if (!plan) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const page of plan.pages) {
    if (page.source.type !== "pdf") continue;
    const docId = page.source.docId;
    if (seen.has(docId)) continue;
    seen.add(docId);
    ids.push(docId);
  }
  return ids;
}

/**
 * Bundle the reports/profiles of a plan's docs for `estimatePlan`; `ready` = every doc has a profile.
 * A plan with no PDF documents needs no profile, so it is ready (blank/image pages are handled by
 * `estimatePlan` itself).
 */
export function collectEstimateInputs(
  docIds: string[],
  reports: (Report | null)[],
  profiles: (Profile | null)[],
): { reports: Record<string, Report>; profiles: Record<string, Profile>; ready: boolean } {
  const reportMap: Record<string, Report> = {};
  const profileMap: Record<string, Profile> = {};
  docIds.forEach((docId, i) => {
    const report = reports[i];
    if (report) reportMap[docId] = report;
    const profile = profiles[i];
    if (profile) profileMap[docId] = profile;
  });
  return {
    reports: reportMap,
    profiles: profileMap,
    ready: docIds.every((_, i) => !!profiles[i]),
  };
}
