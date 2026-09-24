import type { EstimateResult } from "../api/types";
import type { EstimateOutcome } from "./estimate";

export interface DisplayEstimate {
  originalBytes: number;
  estimatedBytes: number;
  targetMet?: boolean;
  level?: { maxDpi: number; quality: number };
}

/** Prefer the instant estimate; fall back to the server result when the instant one is unsupported. */
export function chooseEstimate(
  instant: EstimateOutcome | null,
  server: EstimateResult | null,
): { result: DisplayEstimate | null; instant: boolean } {
  if (instant && instant.kind === "ok") {
    return {
      result: {
        originalBytes: instant.originalBytes,
        estimatedBytes: instant.estimatedBytes,
        targetMet: instant.targetMet,
        level: instant.level,
      },
      instant: true,
    };
  }
  return { result: server, instant: false };
}
