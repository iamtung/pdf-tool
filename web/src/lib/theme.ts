/**
 * Light/dark mode follows the OS setting: toggle the `dark` class on <html> from
 * `prefers-color-scheme` and keep it in sync when the setting changes.
 */

export interface ThemeTarget {
  classList: { toggle(token: string, force?: boolean): void };
}

export interface ThemeMedia {
  matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

export function applyTheme(dark: boolean, target: ThemeTarget = document.documentElement): void {
  target.classList.toggle("dark", dark);
}

/** Apply the current scheme and subscribe to changes; returns an unsubscribe function. */
export function watchTheme(
  media: ThemeMedia = window.matchMedia("(prefers-color-scheme: dark)"),
  target: ThemeTarget = document.documentElement,
): () => void {
  const update = () => applyTheme(media.matches, target);
  update();
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
