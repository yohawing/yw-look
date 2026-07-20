import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  backendCapabilities,
  formatUsdErrorForDisplay,
  isUsdTaskBusyError,
  parseUsdError,
  requiresGlbPreview,
} from "../usd";
import { errorMessage } from "../errors";
import { readBinaryFilePrefix } from "../files";
import type { AppError, BackendCapabilities } from "../../types/ipc";

vi.mock("../files", () => ({
  readBinaryFile: vi.fn(),
  readBinaryFilePrefix: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const readBinaryFilePrefixMock = vi.mocked(readBinaryFilePrefix);

beforeEach(() => {
  vi.clearAllMocks();
  isTauriMock.mockReturnValue(true);
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

describe("requiresGlbPreview fast text decision", () => {
  function encoded(text: string) {
    return new TextEncoder().encode(text).buffer;
  }

  it("decides text USDA composition from the prefix without backend IPC", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded("#usda 1.0\ndef Xform { references = @asset.usda@ }"),
    );

    await expect(requiresGlbPreview("C:\\assets\\stage.usda")).resolves.toBe(
      true,
    );

    expect(readBinaryFilePrefixMock).toHaveBeenCalledWith(
      "C:\\assets\\stage.usda",
      expect.any(Number),
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("decides small plain USDA files from the prefix without decoding the whole file", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded("#usda 1.0\ndef Xform {}"),
    );

    await expect(requiresGlbPreview("C:\\assets\\stage.usda")).resolves.toBe(
      false,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("falls back to backend inspection when a Tauri USDA prefix is saturated", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(new ArrayBuffer(64 * 1024));
    mockInvoke.mockResolvedValueOnce(true);

    await expect(requiresGlbPreview("C:\\assets\\stage.usda")).resolves.toBe(
      true,
    );

    expect(mockInvoke).toHaveBeenCalledWith("requires_glb_preview", {
      path: "C:\\assets\\stage.usda",
    });
  });
});
