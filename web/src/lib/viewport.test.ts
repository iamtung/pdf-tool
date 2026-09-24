import { describe, expect, it } from "vitest";
import {
  PAGE_GAP, currentPage, initialViewportState, isScrollKey, mostVisiblePage, pageLayouts,
  pageOffsetFraction, rotatedBox, scrollTopForOffset, totalHeight, viewportReducer,
} from "./viewport";

describe("pageLayouts", () => {
  it("stacks mixed page sizes with a fixed gap", () => {
    const layouts = pageLayouts([{ width: 100, height: 200 }, { width: 50, height: 300 }], 2);
    expect(layouts[0]).toEqual({ index: 0, top: 0, width: 200, height: 400 });
    expect(layouts[1].top).toBe(400 + PAGE_GAP);
    expect(totalHeight(layouts)).toBe(400 + PAGE_GAP + 600);
  });

  it("uses the rotated box for 90/270 pages", () => {
    expect(rotatedBox(595, 842, 0)).toEqual({ width: 595, height: 842 });
    expect(rotatedBox(595, 842, 90)).toEqual({ width: 842, height: 595 });
    expect(rotatedBox(595, 842, 270)).toEqual({ width: 842, height: 595 });
    const layouts = pageLayouts([rotatedBox(595, 842, 90)], 1);
    expect(layouts[0]).toMatchObject({ width: 842, height: 595 });
  });
});

describe("mostVisiblePage", () => {
  // three 100px pages with 20px gaps: tops 0, 120, 240; total 340
  const layouts = pageLayouts([{ width: 10, height: 100 }, { width: 10, height: 100 }, { width: 10, height: 100 }], 1);

  it("picks the page that fills most of the viewport", () => {
    expect(mostVisiblePage(layouts, 0, 100)).toBe(0);
    expect(mostVisiblePage(layouts, 250, 100)).toBe(2);
  });

  it("picks the nearest page while inside a gap", () => {
    expect(mostVisiblePage(layouts, 100, 10)).toBe(0); // gap 100-120, closer to page 0 bottom
    expect(mostVisiblePage(layouts, 119, 2)).toBe(1); // closer to page 1 top
  });

  it("stays on the last page at the end of the document", () => {
    expect(mostVisiblePage(layouts, totalHeight(layouts) - 60, 100)).toBe(2);
    expect(mostVisiblePage(layouts, 10_000, 100)).toBe(2);
  });
});

describe("zoom anchor", () => {
  it("keeps the same page and relative offset", () => {
    const boxes = [{ width: 100, height: 200 }, { width: 100, height: 300 }];
    const before = pageLayouts(boxes, 1);
    const scrollTop = before[1].top + 0.5 * before[1].height;
    const fraction = pageOffsetFraction(before[1], scrollTop);
    const after = pageLayouts(boxes, 2);
    const nextScroll = scrollTopForOffset(after[1], fraction);
    expect(pageOffsetFraction(after[1], nextScroll)).toBeCloseTo(fraction, 6);
    expect(after[1].index).toBe(before[1].index);
  });
});

describe("sticky navigation state machine", () => {
  it("ignores scroll updates while a navigated page is sticky", () => {
    let state = viewportReducer(initialViewportState, { type: "navigate", index: 4 });
    state = viewportReducer(state, { type: "scroll" });
    expect(currentPage(state, 1)).toBe(4);
  });

  it("resumes tracking after user intent", () => {
    let state = viewportReducer(initialViewportState, { type: "navigate", index: 4 });
    state = viewportReducer(state, { type: "user-intent" });
    expect(currentPage(state, 1)).toBe(1);
  });

  it("stays on the last page even though it cannot reach the top", () => {
    const last = 39;
    let state = viewportReducer(initialViewportState, { type: "navigate", index: last });
    state = viewportReducer(state, { type: "scroll" });
    expect(currentPage(state, last - 2)).toBe(last);
  });

  it("recognises scroll keys", () => {
    for (const key of ["PageUp", "PageDown", "Home", "End", " "]) expect(isScrollKey(key)).toBe(true);
    expect(isScrollKey("a")).toBe(false);
  });
});
