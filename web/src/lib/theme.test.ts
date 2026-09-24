import { describe, expect, it, vi } from "vitest";
import { applyTheme, watchTheme, type ThemeMedia, type ThemeTarget } from "./theme";

function fakeTarget() {
  const calls: [string, boolean | undefined][] = [];
  const target: ThemeTarget = {
    classList: { toggle: (token, force) => calls.push([token, force]) },
  };
  return { target, calls };
}

function fakeMedia(matches: boolean) {
  const listeners: (() => void)[] = [];
  const media = {
    matches,
    addEventListener: (_type: "change", listener: () => void) => listeners.push(listener),
    removeEventListener: vi.fn(),
  };
  return { media: media as unknown as ThemeMedia, mediaState: media, listeners };
}

describe("theme", () => {
  it("toggles exactly the dark class", () => {
    const { target, calls } = fakeTarget();
    applyTheme(true, target);
    applyTheme(false, target);
    expect(calls).toEqual([["dark", true], ["dark", false]]);
  });

  it("applies the current scheme and updates on change", () => {
    const { target, calls } = fakeTarget();
    const { media, mediaState, listeners } = fakeMedia(true);
    watchTheme(media, target);
    expect(calls).toEqual([["dark", true]]);
    mediaState.matches = false;
    listeners[0]();
    expect(calls).toEqual([["dark", true], ["dark", false]]);
  });

  it("stops listening after unsubscribe", () => {
    const { target } = fakeTarget();
    const { media, mediaState } = fakeMedia(false);
    const stop = watchTheme(media, target);
    stop();
    expect(mediaState.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
