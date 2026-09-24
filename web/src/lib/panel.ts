export type PanelTab = "page" | "overview";

/**
 * Right-panel tab rule (spec §11.5): a *user* page selection switches to "Trang". The user-selection
 * counter changes on every user selection (including re-selecting the current page) and never on
 * scrolling, so a scroll-driven page change — or a manual tab choice — keeps the current tab.
 */
export function tabAfterSelection(previousSelection: number, nextSelection: number, current: PanelTab): PanelTab {
  return nextSelection !== previousSelection ? "page" : current;
}
