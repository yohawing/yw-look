import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  backendCapabilities,
  formatUsdErrorForDisplay,
  isUsdTaskBusyError,
  parseUsdError,
} from "../usd";
import { errorMessage } from "../errors";
import type { AppError, BackendCapabilities } from "../../types/ipc";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

const invalidVariantMessage =
  "USD_INVALID_VARIANT_SELECTION\tprimPath=/Root\tsetName=lod\tvariantName=high";

describe("backendCapabilities", () => {
  it("invokes backend_capabilities", async () => {
    const capabilities: BackendCapabilities = {
      inspect: true,
      geometry: true,
      source: false,
      session: true,
      light: false,
    };
    mockInvoke.mockResolvedValueOnce(capabilities);

    await expect(backendCapabilities()).resolves.toEqual(capabilities);
    expect(mockInvoke).toHaveBeenCalledWith("backend_capabilities");
  });
});

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

  it("detects structured USD task busy errors", () => {
    const error: AppError = {
      kind: "internal",
      message: "USD_TASK_BUSY",
    };

    expect(isUsdTaskBusyError(error)).toBe(true);
    expect(isUsdTaskBusyError({ kind: "internal", message: "other" })).toBe(
      false,
    );
  });
});
