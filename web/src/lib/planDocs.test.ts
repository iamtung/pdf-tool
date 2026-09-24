import { describe, expect, it } from "vitest";
import type { Plan, PlanPage, Profile, Report } from "../api/types";
import { collectEstimateInputs, planDocIds } from "./planDocs";

const pdf = (id: string, docId: string): PlanPage => ({ id, source: { type: "pdf", docId, index: 0 }, rotate: 0, compress: null });
const blank = (id: string): PlanPage => ({ id, source: { type: "blank", width: 10, height: 20 }, rotate: 0, compress: null });
const image = (id: string): PlanPage => ({ id, source: { type: "image", path: "/tmp/x.jpg" }, rotate: 0, compress: null });

describe("planDocIds", () => {
  it("collects distinct PDF doc ids in first-seen order", () => {
    const plan: Plan = { pages: [pdf("a", "d2"), blank("b"), pdf("c", "d1"), pdf("d", "d2"), image("e")], fileCompression: null };
    expect(planDocIds(plan)).toEqual(["d2", "d1"]);
  });

  it("handles an empty or null plan", () => {
    expect(planDocIds({ pages: [], fileCompression: null })).toEqual([]);
    expect(planDocIds(null)).toEqual([]);
  });
});

describe("collectEstimateInputs", () => {
  const report = { pageCount: 1 } as unknown as Report;
  const profile = { version: 1 } as unknown as Profile;

  it("maps present reports/profiles and is ready only when every doc has a profile", () => {
    const full = collectEstimateInputs(["d1", "d2"], [report, report], [profile, profile]);
    expect(Object.keys(full.reports)).toEqual(["d1", "d2"]);
    expect(Object.keys(full.profiles)).toEqual(["d1", "d2"]);
    expect(full.ready).toBe(true);

    const partial = collectEstimateInputs(["d1", "d2"], [report, null], [profile, null]);
    expect(Object.keys(partial.reports)).toEqual(["d1"]);
    expect(Object.keys(partial.profiles)).toEqual(["d1"]);
    expect(partial.ready).toBe(false);
  });

  it("is not ready for an empty plan", () => {
    expect(collectEstimateInputs([], [], []).ready).toBe(false);
  });
});
