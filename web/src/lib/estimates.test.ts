import { describe, expect, it } from "vitest";
import { chooseEstimate } from "./estimates";

const server = { originalBytes: 100, estimatedBytes: 40 };

describe("chooseEstimate", () => {
  it("prefers an instant ok outcome", () => {
    const picked = chooseEstimate(
      { kind: "ok", originalBytes: 200, estimatedBytes: 50, targetMet: true, level: { maxDpi: 150, quality: 75 } },
      server,
    );
    expect(picked.instant).toBe(true);
    expect(picked.result).toEqual({
      originalBytes: 200, estimatedBytes: 50, targetMet: true, level: { maxDpi: 150, quality: 75 },
    });
  });

  it("falls back to the server result when instant is unsupported", () => {
    const picked = chooseEstimate({ kind: "unsupported", reason: "manual" }, server);
    expect(picked.instant).toBe(false);
    expect(picked.result).toEqual(server);
  });

  it("falls back when there is no instant outcome", () => {
    expect(chooseEstimate(null, server)).toEqual({ result: server, instant: false });
    expect(chooseEstimate(null, null)).toEqual({ result: null, instant: false });
  });
});
