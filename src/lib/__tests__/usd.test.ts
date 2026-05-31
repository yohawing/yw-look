import { describe, expect, it } from "vitest";
import { formatUsdErrorForDisplay, parseUsdError } from "../usd";
import { errorMessage } from "../invokeSafe";
import type { AppError } from "../../types/ipc";

const invalidVariantMessage =
  "USD_INVALID_VARIANT_SELECTION\tprimPath=/Root\tsetName=lod\tvariantName=high";

describe("USD error parsing", () => {
  it("parses invalid variant selection from structured Tauri AppError", () => {
    const error: AppError = {
      kind: "usd",
      message: invalidVariantMessage,
    };

    expect(parseUsdError(error)).toEqual({
      kind: "invalidVariantSelection",
      primPath: "/Root",
      setName: "lod",
      variantName: "high",
    });
  });

  it("formats structured Tauri AppError messages", () => {
    const error: AppError = {
      kind: "usd",
      message: "USD backend capability unavailable: source",
    };

    expect(formatUsdErrorForDisplay(error, "fallback")).toBe(
      "USD backend capability unavailable: source",
    );
    expect(errorMessage(error, "fallback")).toBe(
      "USD backend capability unavailable: source",
    );
  });
});
