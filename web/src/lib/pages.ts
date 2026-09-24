import type { DocInfo, PlanPage } from "../api/types";

/** Unrotated size (points) of a plan page, before applying page.rotate. */
export function baseSize(page: PlanPage, docs: Record<string, DocInfo>): { width: number; height: number } {
  const s = page.source;
  if (s.type === "pdf") {
    const dims = docs[s.docId]?.pages[s.index];
    return dims ? { width: dims.width, height: dims.height } : { width: 595, height: 842 };
  }
  if (s.type === "blank") return { width: s.width, height: s.height };
  return { width: 595, height: 842 }; // image pages: real size unknown client-side
}

/** Size after the plan rotation. */
export function displaySize(page: PlanPage, docs: Record<string, DocInfo>) {
  const { width, height } = baseSize(page, docs);
  return page.rotate % 180 ? { width: height, height: width } : { width, height };
}

/**
 * Default "insert blank page" size for an insert at index `at`: the reference page the user
 * named (page X for "before page X" = pages[at], for "after page X" = pages[at - 1]),
 * falling back to the other neighbour, or A4.
 */
export function neighbourSize(
  pages: PlanPage[], at: number, docs: Record<string, DocInfo>, where: "before" | "after" = "after",
) {
  const ref = where === "before" ? pages[at] ?? pages[at - 1] : pages[at - 1] ?? pages[at];
  return ref ? displaySize(ref, docs) : { width: 595, height: 842 };
}
