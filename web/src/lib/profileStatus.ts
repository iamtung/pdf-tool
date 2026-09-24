export type ProfileState = "computing" | "ready" | "error";

/** Status of a document's compression profile for the UI (spec §11.2/§11.6). */
export function profileState(
  profile: unknown | null | undefined,
  error: unknown | null | undefined,
): ProfileState {
  if (profile) return "ready";
  if (error) return "error";
  return "computing";
}
