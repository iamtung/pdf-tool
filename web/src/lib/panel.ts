export type PanelTab = "page" | "overview";

/**
 * Right-panel tab rule (spec §11.5): selecting a page switches to "Trang"; a manual tab choice
 * sticks until the next page selection.
 */
export function tabAfterPageChange(previousId: string | null, nextId: string | null, current: PanelTab): PanelTab {
  return nextId !== previousId ? "page" : current;
}
