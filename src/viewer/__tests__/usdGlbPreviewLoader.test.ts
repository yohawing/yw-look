import { beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SelectedFile } from "../../lib/files";
import type { StageInspection } from "../../lib/usd";

const mocks = vi.hoisted(() => ({
  extractGeometry: vi.fn(),
  inspectStage: vi.fn(),
  parseAsync: vi.fn(),
  requiresGlbPreview: vi.fn(),
}));

vi.mock("../../lib/usd", () => ({
  extractGeometry: mocks.extractGeometry,
  inspectStage: mocks.inspectStage,
  requiresGlbPreview: mocks.requiresGlbPreview,
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    parseAsync(buffer: ArrayBuffer, path: string) {
      return mocks.parseAsync(buffer, path);
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

describe("USD GLB preview runtime hints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requiresGlbPreview.mockResolvedValue(true);
    mocks.extractGeometry.mockResolvedValue(new ArrayBuffer(8));
  });

  it("returns after GLTF parsing without fetching runtime hints when no inspection is reusable", async () => {
    const scene = new Group();
    mocks.parseAsync.mockResolvedValue({ scene, animations: [] });

    const { loadPreviewObject } = await import("../loaders");

    const loaded = await loadPreviewObject(file, undefined, {
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

    const { loadPreviewObject } = await import("../loaders");

    const loaded = await loadPreviewObject(file, undefined, {
      getUsdInspection: () => createInspection(),
    });

    expect(loaded.object).toBe(scene);
    expect(mocks.inspectStage).not.toHaveBeenCalled();
    expect(scene.scale.x).toBe(1);
    expect(scene.scale.y).toBe(1);
    expect(scene.scale.z).toBe(1);
  });
});
