import { describe, expect, it } from "vitest";
import { tabAfterPageChange } from "./panel";

describe("tabAfterPageChange", () => {
  it("switches to the page tab when the page changes", () => {
    expect(tabAfterPageChange("a", "b", "overview")).toBe("page");
    expect(tabAfterPageChange(null, "a", "overview")).toBe("page");
  });

  it("keeps a manual tab choice while the page is unchanged", () => {
    expect(tabAfterPageChange("a", "a", "overview")).toBe("overview");
    expect(tabAfterPageChange("a", "a", "page")).toBe("page");
  });

  it("keeps a manual tab choice when scrolling changes the page", () => {
    expect(tabAfterPageChange("a", "b", "overview", "scroll")).toBe("overview");
    expect(tabAfterPageChange("a", "b", "page", "scroll")).toBe("page");
  });

  it("switches to the page tab on a user page selection", () => {
    expect(tabAfterPageChange("a", "b", "overview", "user")).toBe("page");
  });
});
