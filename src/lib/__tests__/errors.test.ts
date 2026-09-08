import { describe, expect, it } from "vitest";
import {
  errorMessage,
  isStructuredErrorShape,
  normalizeErrorMessage,
} from "../errors";

describe("errorMessage", () => {
  it("formats common error shapes without Tauri dependencies", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
    expect(errorMessage("plain failure", "fallback")).toBe("plain failure");
    expect(errorMessage("   ", "fallback")).toBe("fallback");
    expect(
      errorMessage({ kind: "usd", message: "USD failed" }, "fallback"),
    ).toBe("USD failed");
    expect(errorMessage(null, "fallback")).toBe("fallback");
  });

  it("detects structured AppError-like objects", () => {
    expect(isStructuredErrorShape({ kind: "io", message: "missing" })).toBe(
      true,
    );
    expect(isStructuredErrorShape({ kind: "io" })).toBe(false);
    expect(isStructuredErrorShape("missing")).toBe(false);
  });
});

describe("normalizeErrorMessage", () => {
  it("preserves structured AppError shape and normalizes unknown errors", () => {
    expect(
      normalizeErrorMessage({ kind: "usd", message: "bad stage" }),
    ).toEqual({
      kind: "usd",
      message: "bad stage",
    });
    expect(normalizeErrorMessage(new Error("boom"))).toEqual({
      kind: "internal",
      message: "boom",
    });
  });

  it("preserves structured details for native preview failures", () => {
    expect(
      normalizeErrorMessage({
        kind: "memoryLimit",
        message: "preview stopped",
        details: { stage: "tessellation", limit: 100, observed: 120 },
      }),
    ).toEqual({
      kind: "memoryLimit",
      message: "preview stopped",
      details: { stage: "tessellation", limit: 100, observed: 120 },
    });
  });
});
