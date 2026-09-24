/** Pure geometry + state machine for the continuous-scroll viewer (spec §11.4). */

export const PAGE_GAP = 16;

export interface PageBox {
  width: number;
  height: number;
}

export interface PageLayout {
  index: number;
  top: number;
  width: number;
  height: number;
}

/** Apply a page rotation to its display box (rotated 90/270 swaps the axes). */
export function rotatedBox(width: number, height: number, rotate: number): PageBox {
  return rotate % 180 ? { width: height, height: width } : { width, height };
}

/** Vertical layout of every page at `zoom`, pages separated by PAGE_GAP. */
export function pageLayouts(boxes: PageBox[], zoom: number): PageLayout[] {
  const out: PageLayout[] = [];
  let top = 0;
  boxes.forEach((box, index) => {
    const width = box.width * zoom;
    const height = box.height * zoom;
    out.push({ index, top, width, height });
    top += height + PAGE_GAP;
  });
  return out;
}

export function totalHeight(layouts: PageLayout[]): number {
  if (!layouts.length) return 0;
  const last = layouts[layouts.length - 1];
  return last.top + last.height;
}

/** Index of the page with the largest visible height in [scrollTop, scrollTop + viewport]. */
export function mostVisiblePage(layouts: PageLayout[], scrollTop: number, viewport: number): number {
  if (!layouts.length) return -1;
  const viewBottom = scrollTop + viewport;
  let best = layouts[0].index;
  let bestVisible = -Infinity;
  for (const page of layouts) {
    const visible = Math.min(page.top + page.height, viewBottom) - Math.max(page.top, scrollTop);
    if (visible > bestVisible) {
      bestVisible = visible;
      best = page.index;
    }
  }
  return best;
}

/** Fraction of the page that sits above the viewport top (0 = page fully visible at the top). */
export function pageOffsetFraction(layout: PageLayout, scrollTop: number): number {
  return layout.height > 0 ? (scrollTop - layout.top) / layout.height : 0;
}

export function scrollTopForOffset(layout: PageLayout, fraction: number): number {
  return layout.top + fraction * layout.height;
}

export interface ViewportState {
  /** Page index that stays current after a programmatic navigation until the user scrolls. */
  sticky: number | null;
}

export type ViewportEvent =
  | { type: "navigate"; index: number }
  | { type: "scroll" }
  | { type: "user-intent" }
  | { type: "reset" };

export const initialViewportState: ViewportState = { sticky: null };

export function viewportReducer(state: ViewportState, event: ViewportEvent): ViewportState {
  switch (event.type) {
    case "navigate":
      return { sticky: event.index };
    case "user-intent":
      return state.sticky === null ? state : { sticky: null };
    case "scroll":
      return state;
    case "reset":
      return initialViewportState;
  }
}

/** The current page: the sticky navigated page, else the most visible one. */
export function currentPage(state: ViewportState, mostVisible: number): number {
  return state.sticky ?? mostVisible;
}

/** Keys that scroll the container (clear the sticky page). */
export function isScrollKey(key: string): boolean {
  return key === "PageUp" || key === "PageDown" || key === "Home" || key === "End" || key === " " || key === "Spacebar";
}
