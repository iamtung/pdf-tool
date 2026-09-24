import { describe, expect, it } from "vitest";
import type { DocInfo, Plan, PlanPage } from "../api/types";
import {
  buildFileCompression, canCompare, coversAllPages, defaultDestination, effectivePreset, isFullExport,
  parseRanges, subsetPlan, validateCompression,
} from "./dialogs";
import { neighbourSize } from "./pages";

const pdf = (id: string, docId: string, index = 0): PlanPage => ({ id, source: { type: "pdf", docId, index }, rotate: 0, compress: null });
const blank = (id: string, width = 100, height = 200): PlanPage => ({ id, source: { type: "blank", width, height }, rotate: 0, compress: null });
const doc = (docId: string, path: string, uploaded = false) =>
  ({ docId, path, uploaded, name: path.split("/").pop(), pages: [{ width: 595, height: 842, rotation: 0 }] }) as unknown as DocInfo;

describe("parseRanges", () => {
  it("parses like the backend", () => {
    expect(parseRanges("1-2, 4", 5)).toEqual({ ranges: [[0, 1], [3]] });
    expect(parseRanges(" 3 - 5 ,", 5)).toEqual({ ranges: [[2, 3, 4]] });
  });
  it("rejects bad input", () => {
    expect(parseRanges("", 5)).toHaveProperty("error");
    expect(parseRanges(" , ", 5)).toHaveProperty("error");
    expect(parseRanges("0-2", 5)).toHaveProperty("error");
    expect(parseRanges("4-6", 5)).toHaveProperty("error");
    expect(parseRanges("3-2", 5)).toHaveProperty("error");
    expect(parseRanges("a", 5)).toHaveProperty("error");
    expect(parseRanges("1", 0)).toHaveProperty("error");
  });
});

describe("coverage", () => {
  it("coversAllPages", () => {
    expect(coversAllPages("1-3,4-5", 5)).toBe(true);
    expect(coversAllPages("1-3, 2-5", 5)).toBe(true);
    expect(coversAllPages("1-3", 5)).toBe(false);
    expect(coversAllPages("bad", 5)).toBe(false);
  });
  it("isFullExport", () => {
    expect(isFullExport(undefined, null, 5)).toBe(true);
    expect(isFullExport(["a"], null, 5)).toBe(false);
    expect(isFullExport(undefined, { mode: "size", maxMB: 10 }, 5)).toBe(true);
    expect(isFullExport(undefined, { mode: "ranges", ranges: "1-5" }, 5)).toBe(true);
    expect(isFullExport(undefined, { mode: "ranges", ranges: "1-4" }, 5)).toBe(false);
  });
  it("canCompare", () => {
    expect(canCompare(1, null)).toBe(true);
    expect(canCompare(1, { mode: "size", maxMB: 5 })).toBe(true);
    expect(canCompare(2, null)).toBe(false);
    expect(canCompare(1, { mode: "ranges", ranges: "2-3" })).toBe(false);
  });
});

describe("subsetPlan / defaultDestination", () => {
  const plan: Plan = { pages: [blank("b"), pdf("x", "d2"), pdf("y", "d1")], fileCompression: null };
  const docs = { d1: doc("d1", "/a/one.pdf"), d2: doc("d2", "/b/two.pdf"), up: doc("up", "/tmp/u/x.pdf", true) };
  it("keeps plan order", () => {
    expect(subsetPlan(plan, ["y", "b"]).pages.map((p) => p.id)).toEqual(["b", "y"]);
    expect(subsetPlan(plan)).toBe(plan);
  });
  it("uses the first PDF page's doc", () => {
    expect(defaultDestination(plan, docs)).toBe("/b");
    expect(defaultDestination(subsetPlan(plan, ["y"]), docs)).toBe("/a");
    expect(defaultDestination(subsetPlan(plan, ["b"]), docs)).toBe("~/Downloads");
    expect(defaultDestination({ pages: [pdf("u", "up")], fileCompression: null }, docs)).toBe("~/Downloads");
  });
});

describe("compression input", () => {
  it("validates advanced values", () => {
    expect(validateCompression({ preset: null, target: "", adv: { maxDpi: 35 } })).toHaveProperty("maxDpi");
    expect(validateCompression({ preset: null, target: "", adv: { maxDpi: 150.5 } })).toHaveProperty("maxDpi");
    expect(validateCompression({ preset: null, target: "", adv: { jpegQuality: 101 } })).toHaveProperty("jpegQuality");
    expect(validateCompression({ preset: null, target: "0", adv: {} })).toHaveProperty("target");
    expect(validateCompression({ preset: null, target: "5", adv: { maxDpi: 150, jpegQuality: 70 } })).toEqual({});
  });
  it("builds fc", () => {
    expect(buildFileCompression({ preset: "email", target: "", adv: {} })).toEqual({ preset: "email", targetMB: null, advanced: {} });
    expect(buildFileCompression({ preset: "email", target: "8", adv: {} })).toEqual({ preset: null, targetMB: 8, advanced: {} });
    expect(buildFileCompression({ preset: null, target: "8", adv: { maxDpi: 100 } })).toEqual({ preset: "balanced", targetMB: null, advanced: { maxDpi: 100 } });
    expect(buildFileCompression({ preset: null, target: "", adv: { maxDpi: 1 } })).toBeNull();
    expect(effectivePreset({ preset: null, target: "", adv: {} })).toBe("balanced");
  });
});

describe("neighbourSize", () => {
  const pages = [blank("a", 100, 200), blank("b", 300, 400)];
  it("before page X uses page X", () => {
    expect(neighbourSize(pages, 1, {}, "before")).toEqual({ width: 300, height: 400 });
    expect(neighbourSize(pages, 1, {}, "after")).toEqual({ width: 100, height: 200 });
    expect(neighbourSize(pages, 2, {}, "before")).toEqual({ width: 300, height: 400 });
    expect(neighbourSize([], 0, {}, "before")).toEqual({ width: 595, height: 842 });
  });
});
