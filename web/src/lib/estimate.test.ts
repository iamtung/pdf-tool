import { describe, expect, it } from "vitest";
import type { Plan, Profile } from "../api/types";
import { estimatePlan, pageGroup, resolveFile, type EstimateInput, type EstimateOutcome } from "./estimate";
import vectors from "./estimate.vectors.json";

const CASES = vectors as unknown as { name: string; input: EstimateInput; expected: EstimateOutcome }[];

describe("estimatePlan parity vectors", () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const got = estimatePlan(testCase.input);
      const expected = testCase.expected;
      if (expected.kind === "unsupported") {
        expect(got).toEqual(expected);
        return;
      }
      expect(got.kind).toBe("ok");
      if (got.kind !== "ok") return;
      expect(got.originalBytes).toBe(expected.originalBytes);
      expect(Math.abs(got.estimatedBytes - expected.estimatedBytes)).toBeLessThanOrEqual(1);
      expect(got.level ?? null).toEqual(expected.level ?? null);
      expect(got.targetMet ?? null).toEqual(expected.targetMet ?? null);
    });
  }
});

describe("estimatePlan properties", () => {
  const profile: Profile = {
    version: 1,
    settings: {},
    ratios: {
      "scan:hi": { "200-85-0": 0.5, "150-75-0": 0.4, "120-70-0": 0.3 },
      vector: { "200-85-0": 0.9, "150-75-0": 0.8, "120-70-0": 0.7 },
    },
    pageCount: 2,
    fingerprint: "synthetic",
  };
  const reports = {
    d: {
      pagesDetail: [
        { size: 1_000_000, kind: "scan" as const, maxDpi: 600 },
        { size: 500_000, kind: "vector" as const, maxDpi: 0 },
      ],
    },
  };
  const plan: Plan = {
    pages: [
      { id: "p0", source: { type: "pdf", docId: "d", index: 0 }, rotate: 0, compress: null },
      { id: "p1", source: { type: "pdf", docId: "d", index: 1 }, rotate: 0, compress: null },
    ],
    fileCompression: null,
  };

  it("heavier presets never estimate larger", () => {
    const est = (preset: "high" | "balanced" | "zalo") =>
      estimatePlan({ plan, reports, profiles: { d: profile }, fileCompression: { preset } });
    const high = est("high");
    const balanced = est("balanced");
    const zalo = est("zalo");
    if (high.kind !== "ok" || balanced.kind !== "ok" || zalo.kind !== "ok") {
      throw new Error("expected supported estimates");
    }
    expect(high.estimatedBytes).toBeGreaterThanOrEqual(balanced.estimatedBytes);
    expect(balanced.estimatedBytes).toBeGreaterThanOrEqual(zalo.estimatedBytes);
  });

  it("page groups follow the DPI thresholds", () => {
    expect(pageGroup("scan", 150)).toBe("scan:lo");
    expect(pageGroup("scan", 300)).toBe("scan:mid");
    expect(pageGroup("scan", 301)).toBe("scan:hi");
    expect(pageGroup("vector", 999)).toBe("vector");
  });

  it("resolveFile disables the target when DPI is manual", () => {
    expect(resolveFile({ preset: "email", advanced: { maxDpi: 90 } })?.targetBytes).toBeNull();
    expect(resolveFile({ targetMB: 5 })?.targetBytes).toBe(5_000_000);
  });
});
