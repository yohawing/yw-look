import { beforeEach, describe, expect, it, vi } from "vitest";
import { Box3, type WebGLRenderer } from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  readBinaryFile: vi.fn(),
  splatMeshDispose: vi.fn(),
  sparkRendererDispose: vi.fn(),
  splatMeshCtor: vi.fn(),
  sparkRendererCtor: vi.fn(),
}));

vi.mock("../../../lib/files", () => ({
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("@sparkjsdev/spark", () => {
  class SplatMesh {
    initialized: Promise<SplatMesh>;
    frustumCulled = true;

    constructor(options: {
      fileBytes: ArrayBuffer;
      fileType?: string;
      fileName: string;
    }) {
      mocks.splatMeshCtor(options);
      this.initialized = Promise.resolve(this);
    }

    getBoundingBox() {
      const bounds = new Box3();
      bounds.min.set(-1, -2, -3);
      bounds.max.set(1, 2, 3);
      return bounds;
    }

    dispose() {
      mocks.splatMeshDispose(this);
    }
  }

  class SparkRenderer {
    frustumCulled = true;

    constructor(options: { renderer: WebGLRenderer }) {
      mocks.sparkRendererCtor(options);
    }

    dispose() {
      mocks.sparkRendererDispose(this);
    }
  }

  return { SplatMesh, SparkRenderer };
});

import {
  getSplatFileTypeForExtension,
  loadSparkPreviewObject,
  shouldApplySplatYDownCorrection,
} from "../loaderInstalled";

const splatFile: SelectedFile = {
  path: "C:\\captures\\sample.ply",
  fileName: "sample.ply",
  extension: "ply",
  kind: "model",
  parentDirectory: "C:\\captures",
};

const fileBytes = new Uint8Array([0, 1, 2, 3]).buffer;

describe("Spark loader helpers", () => {
  it.each([
    ["ply", "ply"],
    ["spz", "spz"],
    ["splat", "splat"],
    ["ksplat", "ksplat"],
    ["sog", "pcsogszip"],
  ])("maps .%s to Spark file type %s", (extension, fileType) => {
    expect(getSplatFileTypeForExtension(extension)).toBe(fileType);
  });

  it("keeps SPZ in its native Y-axis orientation", () => {
    expect(shouldApplySplatYDownCorrection("spz")).toBe(false);
    expect(shouldApplySplatYDownCorrection("SPZ")).toBe(false);
  });

  it.each(["ply", "splat", "ksplat", "sog"])(
    "keeps the existing Y-down correction for .%s",
    (extension) => {
      expect(shouldApplySplatYDownCorrection(extension)).toBe(true);
    },
  );
});

describe("loadSparkPreviewObject", () => {
  beforeEach(() => {
    mocks.readBinaryFile.mockReset();
    mocks.splatMeshCtor.mockReset();
    mocks.sparkRendererCtor.mockReset();
    mocks.splatMeshDispose.mockReset();
    mocks.sparkRendererDispose.mockReset();
    mocks.readBinaryFile.mockResolvedValue(fileBytes);
  });

  it("returns a Gaussian Splat preview with SparkRenderer when a renderer is provided", async () => {
    const renderer = {} as WebGLRenderer;
    const stages: string[] = [];

    const result = await loadSparkPreviewObject(splatFile, {
      renderer,
      onStage: (stage) => stages.push(stage),
    });

    expect(mocks.readBinaryFile).toHaveBeenCalledWith(splatFile.path);
    expect(mocks.splatMeshCtor).toHaveBeenCalledWith({
      fileBytes,
      fileType: "ply",
      fileName: splatFile.fileName,
    });
    expect(mocks.sparkRendererCtor).toHaveBeenCalledWith({ renderer });
    expect(result.assetKind).toBe("gaussianSplat");
    expect(result.skipScaleNormalization).toBe(true);
    expect(result.cleanupCallbacks).toHaveLength(2);
    expect(result.object.name).toBe("sample.ply Gaussian Splat Preview");
    expect(result.object.userData.disableAutoFrame).toBe(true);
    expect(result.object.userData.splatBoundsMaxDimension).toBe(6);
    expect(stages).toEqual(["scan", "decode", "scene"]);
  });

  it("rejects with AbortError before file read when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadSparkPreviewObject(splatFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
    expect(mocks.splatMeshCtor).not.toHaveBeenCalled();
  });

  it("rejects with AbortError before constructing SplatMesh when already aborted with fileBytesOverride", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadSparkPreviewObject(
        splatFile,
        { signal: controller.signal },
        fileBytes,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
    expect(mocks.splatMeshCtor).not.toHaveBeenCalled();
  });

  it("rejects with AbortError after file read and prevents SplatMesh construction", async () => {
    const controller = new AbortController();
    mocks.readBinaryFile.mockImplementation(async () => {
      controller.abort();
      return fileBytes;
    });

    await expect(
      loadSparkPreviewObject(splatFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.splatMeshCtor).not.toHaveBeenCalled();
  });

  it("rejects with AbortError after initialization, disposes SplatMesh, and skips SparkRenderer", async () => {
    const controller = new AbortController();
    const renderer = {} as WebGLRenderer;

    mocks.splatMeshCtor.mockImplementation(() => {
      controller.abort();
    });

    await expect(
      loadSparkPreviewObject(splatFile, {
        renderer,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.splatMeshDispose).toHaveBeenCalledOnce();
    expect(mocks.sparkRendererCtor).not.toHaveBeenCalled();
  });
});
