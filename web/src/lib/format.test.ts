import { describe, expect, it } from "vitest";
import { describeFileCompression, formatBytes, paperName, percent } from "./format";

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(412_000_000)).toBe("412 MB");
    expect(formatBytes(2_140_000)).toBe("2.1 MB");
    expect(formatBytes(3_400)).toBe("3 KB");
  });
  it("names paper sizes", () => {
    expect(paperName(595, 842)).toBe("A4 dọc");
    expect(paperName(842, 595)).toBe("A4 ngang");
    expect(paperName(300, 400)).toBe("106×141 mm");
  });
  it("percent", () => expect(percent(87, 100)).toBe("87%"));
  it("describes file compression", () => {
    expect(describeFileCompression({ preset: "email" })).toBe("Email ≤ 20 MB");
    expect(describeFileCompression({ targetMB: 8 })).toBe("dưới 8 MB");
    expect(describeFileCompression({ preset: "high", advanced: { maxDpi: 90 } })).toBe("Tùy chỉnh");
  });
});
