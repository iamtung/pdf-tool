import { describe, expect, it } from "vitest";
import { tabAfterSelection } from "./panel";

describe("tabAfterSelection", () => {
  it("switches to the page tab when the user-selection counter changes", () => {
    expect(tabAfterSelection(0, 1, "overview")).toBe("page");
    expect(tabAfterSelection(3, 4, "page")).toBe("page");
  });

  it("keeps the current tab when the counter is unchanged (scroll, or the same page)", () => {
    expect(tabAfterSelection(3, 3, "overview")).toBe("overview");
    expect(tabAfterSelection(3, 3, "page")).toBe("page");
  });
});
