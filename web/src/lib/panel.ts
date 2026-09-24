export type PanelTab = "page" | "overview";
export type PageOrigin = "user" | "scroll";

/**
 * Right-panel tab rule (spec §11.5): a *user* page selection switches to "Trang"; a manual tab choice
 * sticks while scrolling (scroll-driven page changes keep the tab).
 */
export function tabAfterPageChange(
  previousId: string | null,
  nextId: string | null,
  current: PanelTab,
  origin: PageOrigin = "user",
): PanelTab {
  return nextId !== previousId && origin === "user" ? "page" : current;
}
