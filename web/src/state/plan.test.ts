import { describe, expect, it } from "vitest";
import type { DocInfo } from "../api/types";
import { HISTORY_LIMIT, countOverrides, initialState, reducer, type EditorState } from "./plan";

const doc = (n: number): DocInfo => ({
  docId: "d1", name: "a.pdf", path: "/a.pdf", uploaded: false, repaired: false, size: 1, pageCount: n,
  version: "1.7", encrypted: false, producer: null, creator: null,
  pages: Array.from({ length: n }, () => ({ width: 595, height: 842, rotation: 0 })),
});

const loaded = (n = 4): EditorState => reducer(initialState, { type: "load", doc: doc(n) });
const indices = (s: EditorState) => s.plan.pages.map((p) => (p.source.type === "pdf" ? p.source.index : -1));
const ids = (s: EditorState, ...i: number[]) => i.map((k) => s.plan.pages[k].id);

describe("plan reducer", () => {
  it("loads one page per document page", () => {
    const s = loaded(3);
    expect(indices(s)).toEqual([0, 1, 2]);
    expect(s.dirty).toBe(false);
  });

  it("deletes and undoes/redoes", () => {
    const s0 = loaded();
    const s1 = reducer(s0, { type: "delete", ids: ids(s0, 1, 2) });
    expect(indices(s1)).toEqual([0, 3]);
    expect(s1.dirty).toBe(true);
    const s2 = reducer(s1, { type: "undo" });
    expect(indices(s2)).toEqual([0, 1, 2, 3]);
    expect(indices(reducer(s2, { type: "redo" }))).toEqual([0, 3]);
  });

  it("rotates in 90 degree steps, wrapping", () => {
    const s0 = loaded(1);
    let s = reducer(s0, { type: "rotate", ids: ids(s0, 0), delta: 90 });
    s = reducer(s, { type: "rotate", ids: ids(s0, 0), delta: -180 });
    expect(s.plan.pages[0].rotate).toBe(270);
  });

  it("moves a block of pages to a new position", () => {
    const s0 = loaded(5);
    const s = reducer(s0, { type: "move", ids: ids(s0, 0, 1), toIndex: 4 });
    expect(indices(s)).toEqual([2, 3, 0, 1, 4]);
    const back = reducer(s, { type: "move", ids: ids(s0, 4), toIndex: 0 });
    expect(indices(back)).toEqual([4, 2, 3, 0, 1]);
  });

  it("no-op move does not add history", () => {
    const s0 = loaded(3);
    expect(reducer(s0, { type: "move", ids: ids(s0, 1), toIndex: 1 })).toBe(s0);
  });

  it("inserts pages at a position", () => {
    const s0 = loaded(2);
    const s = reducer(s0, {
      type: "insert", at: 1,
      pages: [{ source: { type: "blank", width: 595, height: 842 }, rotate: 0, compress: null }],
    });
    expect(s.plan.pages.map((p) => p.source.type)).toEqual(["pdf", "blank", "pdf"]);
  });

  it("file compression clears per-page levels, later levels survive (spec 4.5)", () => {
    const s0 = loaded(3);
    let s = reducer(s0, { type: "setCompress", ids: ids(s0, 0, 1), level: "strong" });
    expect(countOverrides(s.plan)).toBe(2);
    s = reducer(s, { type: "applyFileCompression", fc: { preset: "email" } });
    expect(countOverrides(s.plan)).toBe(0);
    expect(s.plan.fileCompression).toEqual({ preset: "email" });
    s = reducer(s, { type: "setCompress", ids: ids(s0, 2), level: "light" });
    expect(s.plan.pages.map((p) => p.compress)).toEqual([null, null, "light"]);
    s = reducer(s, { type: "clearFileCompression" });
    expect(s.plan.fileCompression).toBeNull();
    expect(reducer(s, { type: "undo" }).plan.fileCompression).toEqual({ preset: "email" });
  });

  it("caps history", () => {
    let s = loaded(1);
    const id = s.plan.pages[0].id;
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = reducer(s, { type: "rotate", ids: [id], delta: 90 });
    expect(s.past.length).toBe(HISTORY_LIMIT);
  });

  it("markSaved clears dirty", () => {
    const s0 = loaded(2);
    const s = reducer(reducer(s0, { type: "delete", ids: ids(s0, 0) }), { type: "markSaved" });
    expect(s.dirty).toBe(false);
  });
});
