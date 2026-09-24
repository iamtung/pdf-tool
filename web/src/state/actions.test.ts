import { afterEach, describe, expect, it, vi } from "vitest";
import { DISCARD_CHANGES_PROMPT, confirmDiscard } from "./actions";

afterEach(() => vi.unstubAllGlobals());

describe("confirmDiscard", () => {
  it("does not ask when there are no unsaved changes", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    expect(confirmDiscard(false)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks when dirty and respects the answer", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    expect(confirmDiscard(true)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(DISCARD_CHANGES_PROMPT);
    confirm.mockReturnValue(true);
    expect(confirmDiscard(true)).toBe(true);
  });
});
