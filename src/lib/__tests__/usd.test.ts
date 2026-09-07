import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  backendCapabilities,
  collectAssetIssues,
  formatUsdErrorForDisplay,
  inspectStage,
  inspectUsdLights,
  isUsdTaskBusyError,
  parseUsdError,
  requiresGlbPreview,
  summarizeStage,
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
      session: true,
      light: false,
    };
    mockInvoke.mockResolvedValueOnce(capabilities);

    await expect(backendCapabilities()).resolves.toEqual(capabilities);
    expect(mockInvoke).toHaveBeenCalledWith("backend_capabilities");
  });
});

describe("variant-aware USD inspection IPC", () => {
  it("appends variant selections to all inspection queries", async () => {
    const variantSelections = [
      {
        primPath: "/World/Asset",
        setName: "modelingVariant",
        variantName: "high",
      },
    ];
    mockInvoke.mockResolvedValue([]);

    await inspectStage(
      "C:\\assets\\scene.usda",
      "loadAll",
      {
        background: true,
      },
      variantSelections,
    );
    await summarizeStage(
      "C:\\assets\\scene.usda",
      "loadAll",
      {
        background: true,
      },
      variantSelections,
    );
    await collectAssetIssues(
      "C:\\assets\\scene.usda",
      {
        background: true,
      },
      variantSelections,
    );
    await inspectUsdLights(
      "C:\\assets\\scene.usda",
      {
        background: true,
      },
      variantSelections,
    );

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "inspect_stage", {
      path: "C:\\assets\\scene.usda",
      policy: "loadAll",
      background: true,
      variantSelections,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "summarize_stage", {
      path: "C:\\assets\\scene.usda",
      policy: "loadAll",
      background: true,
      variantSelections,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "collect_asset_issues", {
      path: "C:\\assets\\scene.usda",
      background: true,
      variantSelections,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "inspect_usd_lights", {
      path: "C:\\assets\\scene.usda",
      background: true,
      variantSelections,
    });
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

  it("routes PointInstancer USDA through the GLB backend", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded('#usda 1.0\ndef PointInstancer "Instances" {}'),
    );

    await expect(
      requiresGlbPreview("C:\\assets\\instances.usda"),
    ).resolves.toBe(true);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("routes authored Gaussian splat and Points USDA through the GLB backend", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded('#usda 1.0\ndef ParticleField3DGaussianSplat "Cloud" {}'),
    );

    await expect(
      requiresGlbPreview("C:\\assets\\gaussian-splat.usda"),
    ).resolves.toBe(true);
    expect(mockInvoke).not.toHaveBeenCalled();

    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded('#usda 1.0\ndef Points "Cloud" {}'),
    );

    await expect(requiresGlbPreview("C:\\assets\\points.usda")).resolves.toBe(
      true,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("routes single-layer UsdSkel USDA through the GLB backend", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded(
        '#usda 1.0\ndef SkelAnimation "Anim" { token[] blendShapes = ["Smile"] }',
      ),
    );

    await expect(requiresGlbPreview("C:\\assets\\weights.usda")).resolves.toBe(
      true,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("routes single-layer MaterialX USDA through the GLB backend", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded(
        '#usda 1.0\ndef Shader "Image" { uniform token info:id = "ND_image_color3" }',
      ),
    );

    await expect(
      requiresGlbPreview("C:\\assets\\materialx.usda"),
    ).resolves.toBe(true);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("routes USDA variant sets through the GLB backend", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded(
        '#usda 1.0\ndef Xform "Asset" { variantSet "model" = { "high" } }',
      ),
    );

    await expect(requiresGlbPreview("C:\\assets\\variant.usda")).resolves.toBe(
      true,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("asks the backend to confirm time-sampled xform candidates", async () => {
    readBinaryFilePrefixMock.mockResolvedValueOnce(
      encoded(
        '#usda 1.0\ndef Xform "Animated" {\n  double3 xformOp:translate.timeSamples = { 1: (0, 0, 0), 2: (1, 0, 0) }\n}',
      ),
    );
    mockInvoke.mockResolvedValueOnce(true);

    await expect(
      requiresGlbPreview("C:\\assets\\animated_xform.usda"),
    ).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("requires_glb_preview", {
      path: "C:\\assets\\animated_xform.usda",
    });
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
