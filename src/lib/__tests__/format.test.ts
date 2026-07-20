import { describe, expect, it } from "vitest";
import { formatBytes, linearToHex, rgbToHex } from "../format";

describe("formatBytes", () => {
  it("renders an em dash for null and undefined", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("renders 0 B for negative and non-finite values", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("formats values below 1024 as whole-byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats KB and MB with one decimal place", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024)).toBe("10.0 KB");
    expect(formatBytes(32 * 1024 * 1024)).toBe("32.0 MB");
    expect(formatBytes(96 * 1024 * 1024)).toBe("96.0 MB");
    expect(formatBytes(512 * 1024 * 1024)).toBe("512.0 MB");
  });
});

describe("rgbToHex", () => {
  it("converts ordinary RGB floats to lowercase hex", () => {
    expect(rgbToHex(1, 0, 0)).toBe("#ff0000");
    expect(rgbToHex(0, 1, 0)).toBe("#00ff00");
    expect(rgbToHex(0, 0, 1)).toBe("#0000ff");
    expect(rgbToHex(0.71, 0.65, 0.26)).toBe("#b5a642");
  });

  it("clamps out-of-range channel values before rounding", () => {
    expect(rgbToHex(-0.5, 0.5, 1.5)).toBe("#0080ff");
    expect(rgbToHex(Number.NaN, 0.5, Number.POSITIVE_INFINITY)).toBe("#0080ff");
  });
});

describe("linearToHex", () => {
  it("returns a 2-digit lowercase hex channel", () => {
    expect(linearToHex(0)).toBe("00");
    expect(linearToHex(1)).toBe("ff");
    expect(linearToHex(0.5)).toBe("80");
  });
});
