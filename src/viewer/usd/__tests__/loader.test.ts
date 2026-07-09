import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
} from "three";
import type { SelectedFile } from "../../../lib/files";
import type { StageInspection } from "../../../lib/usd";
import {
  deferredSummaryHasNoRenderableGeometry,
  inspectionHasDeferredPayloads,
  isDeferredUsdEmptyStageError,
  isUsdcCrateBuffer,
  loadUsdPreviewObject,
  readUsdzFirstFileName,
  shouldFailClosedOnUsdPreviewDecisionFailure,
} from "../loader";

const mocks = vi.hoisted(() => ({
  extractGeometry: vi.fn(),
  inspectStage: vi.fn(),
  isTauriEnvironment: vi.fn(),
  parseAsync: vi.fn(),
  parseUsd: vi.fn(),
  parseUsdInWorker: vi.fn(),
  readBinaryFile: vi.fn(),
  requiresGlbPreview: vi.fn(),
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("../../../lib/platform", () => ({
  isTauriEnvironment: mocks.isTauriEnvironment,
}));

vi.mock("../../../lib/usd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/usd")>()),
  extractGeometry: mocks.extractGeometry,
  inspectStage: mocks.inspectStage,
  requiresGlbPreview: mocks.requiresGlbPreview,
}));

vi.mock("../../modelParseWorker", () => ({
  isAbortOrTimeoutError: (error: unknown) =>
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError"),
}));

vi.mock("../../usdWorkerLoader", () => ({
  isUsdWorkerEnabled: () => true,
  parseUsdInWorker: mocks.parseUsdInWorker,
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    parseAsync(buffer: ArrayBuffer, path: string) {
      return mocks.parseAsync(buffer, path);
    }
  },
}));

vi.mock("three/examples/jsm/loaders/USDLoader.js", () => ({
  USDLoader: class {
    parse(input: ArrayBuffer | string) {
      return mocks.parseUsd(input);
    }
  },
}));

const file: SelectedFile = {
  path: "C:\\assets\\stage.usdc",
  fileName: "stage.usdc",
  extension: "usdc",
  kind: "model",
  parentDirectory: "C:\\assets",
};

const usdaFile: SelectedFile = {
  ...file,
  path: "C:\\assets\\stage.usda",
  fileName: "stage.usda",
  extension: "usda",
};

function encoded(text: string) {
  return new TextEncoder().encode(text).buffer;
}

function createInspection(
  overrides: Partial<StageInspection> = {},
): StageInspection {
  return {
    path: file.path,
    defaultPrim: null,
    upAxis: "Y",
    metersPerUnit: 0.01,
    timeCodesPerSecond: null,
    framesPerSecond: null,
    startTimeCode: null,
    endTimeCode: null,
    comment: null,
    rootLayerIsBinary: true,
    rootPrims: [],
    composedLayers: [],
    references: [],
    payloads: [],
    missingAssets: [],
    variantSets: [],
    loadPolicy: "loadAll",
    ...overrides,
  };
}

describe("USD deferred payload handling", () => {
  it("recognizes the empty-stage error produced by deferred payload extraction", () => {
    expect(
      isDeferredUsdEmptyStageError(
        'Parse("no renderable Mesh prims found in stage")',
      ),
    ).toBe(true);
    expect(
      isDeferredUsdEmptyStageError(
        new Error("no renderable Mesh prims found in stage"),
      ),
    ).toBe(true);
  });

  it("does not classify unrelated USD errors as an empty deferred stage", () => {
    expect(isDeferredUsdEmptyStageError("UsdStage::Open returned null")).toBe(
      false,
    );
  });

  it("requires an unloaded payload before treating an empty stage as deferred", () => {
    expect(
      inspectionHasDeferredPayloads({
        payloads: [{ state: "unloaded" }],
      } as Parameters<typeof inspectionHasDeferredPayloads>[0]),
    ).toBe(true);
    expect(
      inspectionHasDeferredPayloads({
        payloads: [{ state: "loaded" }, { state: "missing" }],
      } as Parameters<typeof inspectionHasDeferredPayloads>[0]),
    ).toBe(false);
  });

  it("only skips deferred extraction when no renderable vertices remain", () => {
    expect(
      deferredSummaryHasNoRenderableGeometry({
        unloadedPayloadCount: 1,
        totalVertices: 0,
      }),
    ).toBe(true);
    expect(
      deferredSummaryHasNoRenderableGeometry({
        unloadedPayloadCount: 1,
        totalVertices: 12,
      }),
    ).toBe(false);
    expect(
      deferredSummaryHasNoRenderableGeometry({
        unloadedPayloadCount: 0,
        totalVertices: 0,
      }),
    ).toBe(false);
  });
});

describe("isUsdcCrateBuffer", () => {
  const USDC_MAGIC = new Uint8Array([
    0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43,
  ]);

  it("returns true for a valid USDC header", () => {
    const buffer = new ArrayBuffer(16);
    new Uint8Array(buffer).set(USDC_MAGIC);
    expect(isUsdcCrateBuffer(buffer)).toBe(true);
  });

  it("returns false for a USDA text buffer", () => {
    const buffer = encoded("#usda 1.0\ndef Xform { }");
    expect(isUsdcCrateBuffer(buffer)).toBe(false);
  });

  it("returns false for a buffer shorter than the magic header", () => {
    const buffer = new ArrayBuffer(4);
    new Uint8Array(buffer).set(USDC_MAGIC.slice(0, 4));
    expect(isUsdcCrateBuffer(buffer)).toBe(false);
  });

  it("returns false for an empty buffer", () => {
    expect(isUsdcCrateBuffer(new ArrayBuffer(0))).toBe(false);
  });
});

describe("shouldFailClosedOnUsdPreviewDecisionFailure", () => {
  it.each(["usd", "usda", "usdc", "usdz"])(
    "fails closed for %s in the Tauri runtime",
    (extension) => {
      expect(shouldFailClosedOnUsdPreviewDecisionFailure(extension, true)).toBe(
        true,
      );
    },
  );

  it("keeps the JS fallback available for browser selftests", () => {
    expect(shouldFailClosedOnUsdPreviewDecisionFailure("usda", false)).toBe(
      false,
    );
  });

  it("keeps the USDC JS fallback available for browser selftests", () => {
    expect(shouldFailClosedOnUsdPreviewDecisionFailure("usdc", false)).toBe(
      false,
    );
  });
});

describe("readUsdzFirstFileName", () => {
  function makeZipHeader(fileName: string): ArrayBuffer {
    const nameBytes = new TextEncoder().encode(fileName);
    const bufferSize = 30 + nameBytes.byteLength;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(26, nameBytes.byteLength, true);
    view.setUint16(28, 0, true);
    u8.set(nameBytes, 30);

    return buffer;
  }

  it("returns the file name from a valid ZIP local header", () => {
    const buffer = makeZipHeader("scene.usda");
    expect(readUsdzFirstFileName(buffer)).toBe("scene.usda");
  });

  it("returns null for a buffer without ZIP signature", () => {
    const buffer = new ArrayBuffer(64);
    expect(readUsdzFirstFileName(buffer)).toBeNull();
  });

  it("returns null for a buffer shorter than 30 bytes", () => {
    const buffer = new ArrayBuffer(10);
    expect(readUsdzFirstFileName(buffer)).toBeNull();
  });

  it("returns null when file name length is 0", () => {
    const buffer = makeZipHeader("");
    new DataView(buffer).setUint16(26, 0, true);
    expect(readUsdzFirstFileName(buffer)).toBeNull();
  });
});

describe("loadUsdPreviewObject GLB pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriEnvironment.mockReturnValue(true);
    mocks.requiresGlbPreview.mockResolvedValue(true);
    mocks.extractGeometry.mockResolvedValue(new ArrayBuffer(8));
  });

  it("returns after GLTF parsing without fetching runtime hints when no inspection is reusable", async () => {
    const scene = new Group();
    mocks.parseAsync.mockResolvedValue({ scene, animations: [] });

    const loaded = await loadUsdPreviewObject(file, {
      getUsdInspection: () => null,
    });

    expect(loaded.object).toBe(scene);
    expect(mocks.parseAsync).toHaveBeenCalledWith(expect.any(ArrayBuffer), "");
    expect(mocks.inspectStage).not.toHaveBeenCalled();
    expect(scene.scale.x).toBe(1);
  });

  it("does not reapply matching inspection because GLB extraction bakes runtime hints", async () => {
    const scene = new Group();
    mocks.parseAsync.mockResolvedValue({ scene, animations: [] });

    const loaded = await loadUsdPreviewObject(file, {
      getUsdInspection: () => createInspection(),
    });

    expect(loaded.object).toBe(scene);
    expect(mocks.inspectStage).not.toHaveBeenCalled();
    expect(scene.scale.x).toBe(1);
    expect(scene.scale.y).toBe(1);
    expect(scene.scale.z).toBe(1);
  });

  it("passes variant selections to USD geometry extraction", async () => {
    const scene = new Group();
    mocks.parseAsync.mockResolvedValue({ scene, animations: [] });

    await loadUsdPreviewObject(file, {
      variantSelections: [
        {
          primPath: "/World/Asset",
          setName: "modelingVariant",
          variantName: "LOD_A",
        },
      ],
    });

    expect(mocks.extractGeometry).toHaveBeenCalledWith(file.path, {
      policy: "loadAll",
      variantSelections: [
        {
          primPath: "/World/Asset",
          setName: "modelingVariant",
          variantName: "LOD_A",
        },
      ],
    });
  });

  it("preserves stage order for regular GLB extraction", async () => {
    const stages: string[] = [];
    mocks.parseAsync.mockResolvedValue({ scene: new Group(), animations: [] });

    await loadUsdPreviewObject(file, {
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["resolve", "decode", "gpu", "scene"]);
  });

  it("preserves stage order when using a GLB override", async () => {
    const stages: string[] = [];
    mocks.requiresGlbPreview.mockResolvedValue(false);
    mocks.parseAsync.mockResolvedValue({ scene: new Group(), animations: [] });

    await loadUsdPreviewObject(file, {
      glbOverride: new ArrayBuffer(4),
      onStage: (stage) => stages.push(stage),
    });

    expect(mocks.extractGeometry).not.toHaveBeenCalled();
    expect(stages).toEqual(["resolve", "gpu", "scene"]);
  });

  it("returns an empty group for deferred payloads with no loaded geometry", async () => {
    const warnings: string[] = [];
    mocks.extractGeometry.mockRejectedValue(
      new Error("no renderable Mesh prims found in stage"),
    );
    mocks.inspectStage.mockResolvedValue(
      createInspection({
        loadPolicy: "noPayloads",
        payloads: [
          {
            state: "unloaded",
            sourcePrim: "/World",
            assetPath: "payload.usda",
            targetPrim: "/Payload",
          },
        ],
      }),
    );

    const loaded = await loadUsdPreviewObject(file, {
      usdLoadPolicy: "noPayloads",
      onWarning: (warning) => warnings.push(warning),
    });

    expect(loaded.object).toBeInstanceOf(Group);
    expect(loaded.object.children).toHaveLength(0);
    expect(warnings).toEqual([
      "USD payloads are deferred. Load payload prims from the hierarchy to display geometry.",
    ]);
  });
});

describe("loadUsdPreviewObject USDA pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriEnvironment.mockReturnValue(false);
    mocks.requiresGlbPreview.mockResolvedValue(false);
    mocks.readBinaryFile.mockResolvedValue(encoded("#usda 1.0\ndef Xform {}"));
    mocks.inspectStage.mockResolvedValue(
      createInspection({
        path: usdaFile.path,
        rootLayerIsBinary: false,
        metersPerUnit: 1,
      }),
    );
  });

  it("uses the worker path and applies runtime hints only after USDA parse", async () => {
    const object = new Group();
    const stages: string[] = [];
    mocks.parseUsdInWorker.mockResolvedValue(object);

    const loaded = await loadUsdPreviewObject(usdaFile, {
      onStage: (stage) => stages.push(stage),
    });

    expect(loaded.object).toBe(object);
    expect(mocks.parseUsd).not.toHaveBeenCalled();
    expect(mocks.inspectStage).toHaveBeenCalledWith(usdaFile.path, undefined);
    expect(stages).toEqual(["resolve", "decode", "gpu", "scene"]);
  });

  it("replaces untextured USDLoader fallback materials with a visible double-sided preview material", async () => {
    const object = new Group();
    const mesh = new Mesh(
      new BufferGeometry(),
      new MeshPhysicalMaterial({ color: 0xffffff }),
    );
    object.add(mesh);
    mocks.parseUsdInWorker.mockResolvedValue(object);

    await loadUsdPreviewObject(usdaFile, {});

    const material = mesh.material as unknown as MeshBasicMaterial;
    expect(material.color.getHex()).toBe(0xcfd4dc);
    expect(material.side).toBe(DoubleSide);
  });

  it("falls back to main-thread parsing when the worker fails for a small file", async () => {
    const object = new Group();
    mocks.parseUsdInWorker.mockRejectedValue(new Error("worker failed"));
    mocks.parseUsd.mockReturnValue(object);

    const loaded = await loadUsdPreviewObject(usdaFile, {});

    expect(loaded.object).toBe(object);
    expect(mocks.parseUsd).toHaveBeenCalledWith("#usda 1.0\ndef Xform {}");
  });

  it("rethrows abort errors instead of falling back to main-thread parsing", async () => {
    const abortError = new Error("canceled");
    abortError.name = "AbortError";
    mocks.parseUsdInWorker.mockRejectedValue(abortError);

    await expect(loadUsdPreviewObject(usdaFile, {})).rejects.toBe(abortError);
    expect(mocks.parseUsd).not.toHaveBeenCalled();
  });

  it("fails closed when worker parsing fails for large files", async () => {
    mocks.readBinaryFile.mockResolvedValue(new ArrayBuffer(50 * 1024 * 1024));
    mocks.parseUsdInWorker.mockRejectedValue(new Error("worker failed"));

    await expect(loadUsdPreviewObject(usdaFile, {})).rejects.toThrow(
      "Main thread fallback is disabled for files over 50 MB",
    );
    expect(mocks.parseUsd).not.toHaveBeenCalled();
  });

  it("fails clearly when USDC content reaches the USDA fallback path", async () => {
    const buffer = new ArrayBuffer(16);
    new Uint8Array(buffer).set([
      0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43,
    ]);
    mocks.readBinaryFile.mockResolvedValue(buffer);

    await expect(loadUsdPreviewObject(file, {})).rejects.toThrow(
      "USDC binary content detected",
    );
  });

  it("fails closed in Tauri when the GLB preview decision cannot be made", async () => {
    mocks.isTauriEnvironment.mockReturnValue(true);
    mocks.requiresGlbPreview.mockRejectedValue(new Error("backend failed"));

    await expect(loadUsdPreviewObject(usdaFile, {})).rejects.toThrow(
      "Unable to determine whether stage.usda requires the USD composition backend",
    );
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
  });
});
