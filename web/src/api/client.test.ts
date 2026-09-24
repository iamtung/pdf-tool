import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, errorFrom } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("errorFrom", () => {
  it("uses the backend code and message", async () => {
    const res = new Response(JSON.stringify({ code: "bad_request", message: "Sai rồi" }), { status: 400 });
    const e = await errorFrom(res, "fallback");
    expect(e).toBeInstanceOf(ApiError);
    expect([e.code, e.message, e.status]).toEqual(["bad_request", "Sai rồi", 400]);
  });

  it("falls back when the body is not JSON", async () => {
    const e = await errorFrom(new Response("oops", { status: 500 }), "Tải file lên thất bại.");
    expect([e.code, e.message]).toEqual(["internal", "Tải file lên thất bại."]);
  });
});

describe("upload / renderSource errors", () => {
  it("surface the backend error", async () => {
    const body = JSON.stringify({ code: "forbidden", message: "Bị từ chối" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 403 })));
    await expect(api.upload(new File(["x"], "a.pdf"))).rejects.toMatchObject({ code: "forbidden", message: "Bị từ chối" });
    await expect(api.renderSource({ type: "blank", width: 10, height: 10 }, 100)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
