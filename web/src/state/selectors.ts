import { useAnalysis } from "../api/hooks";
import type { PageDetail, PlanPage } from "../api/types";
import { useApp } from "./app";

/** The page shown in the centre: explicit current page, else the first page. */
export function useCurrentPage(): { page: PlanPage | null; index: number } {
  const { editor, currentId } = useApp();
  const pages = editor.plan.pages;
  const i = currentId ? pages.findIndex((p) => p.id === currentId) : -1;
  const index = i >= 0 ? i : pages.length ? 0 : -1;
  return { page: index >= 0 ? pages[index] : null, index };
}

/** Analysis detail for a plan page (only pages coming from a PDF). */
export function usePageDetail(page: PlanPage | null): PageDetail | null {
  const docId = page?.source.type === "pdf" ? page.source.docId : null;
  const { report } = useAnalysis(docId);
  if (!report || page?.source.type !== "pdf") return null;
  return report.pagesDetail[page.source.index] ?? null;
}

/** Ids of the pages an action applies to: the selection, or the current page. */
export function useTargetIds(): string[] {
  const { selected } = useApp();
  const { page } = useCurrentPage();
  if (selected.size) return [...selected];
  return page ? [page.id] : [];
}
