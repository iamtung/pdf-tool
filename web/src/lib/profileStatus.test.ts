import { describe, expect, it } from "vitest";
import { profileState } from "./profileStatus";

describe("profileState", () => {
  it("is ready once a profile exists", () => {
    expect(profileState({ version: 1 }, null)).toBe("ready");
  });

  it("is error when only an error exists", () => {
    expect(profileState(null, new Error("boom"))).toBe("error");
    expect(profileState(undefined, new Error("boom"))).toBe("error");
  });

  it("is computing while neither is present", () => {
    expect(profileState(null, null)).toBe("computing");
    expect(profileState(undefined, undefined)).toBe("computing");
  });
});
