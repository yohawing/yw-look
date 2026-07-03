import { beforeEach, describe, expect, it, vi } from "vitest";
import { Mesh, BufferGeometry } from "three";
import type { WebGLRenderer } from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  loadSparkPreviewObject: vi.fn(),
  parseModelInWorker: vi.fn(),
  readBinaryFile: vi.fn(),
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("../../modelParseWorker", () => ({
  isAbortOrTimeoutError: (error: unknown) =>
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError"),
  parseModelInWorker: mocks.parseModelInWorker,
}));

vi.mock("../../../packs", () => ({
  loadSparkPreviewObject: mocks.loadSparkPreviewObject,
}));

const plyFile: SelectedFile = {
  extension: "ply",
  fileName: "asset.ply",
  kind: "model",
  parentDirectory: "C:\\assets",
  path: "C:\\assets\\asset.ply",
};

function encoded(text: string) {
  return new TextEncoder().encode(text).buffer;
}

function pointCloudPly() {
  return encoded(`ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
end_header
0 0 0
`);
}

function meshPly() {
  return encoded(`ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`);
}

function splatPly() {
  return encoded(`ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property float f_dc_0
end_header
0 0 0 1
`);
}

describe("loadPlyPreviewObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads point cloud PLY files through the point cloud builder", async () => {
    mocks.readBinaryFile.mockResolvedValue(pointCloudPly());
    const { loadPlyPreviewObject } = await import("../loader");

    const result = await loadPlyPreviewObject(plyFile, {});

    expect(result.assetKind).toBe("pointCloud");
    expect(mocks.parseModelInWorker).not.toHaveBeenCalled();
    expect(mocks.loadSparkPreviewObject).not.toHaveBeenCalled();
  });

  it("loads mesh PLY files through the model parse worker", async () => {
    const object = new Mesh(new BufferGeometry());
    const buffer = meshPly();
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadPlyPreviewObject } = await import("../loader");

    const result = await loadPlyPreviewObject(plyFile, {
      parseTimeoutMs: 123,
    });

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      plyFile.path,
      { kind: "ply", buffer },
      { signal: undefined, timeoutMs: 123 },
    );
    expect(result).toMatchObject({
      object,
      cleanupUrls: [],
      clips: [],
      formatVersion: null,
      assetKind: "mesh",
    });
  });

  it("hands Gaussian Splat PLY files to the Spark loader with the already-read buffer", async () => {
    const renderer = {} as WebGLRenderer;
    const buffer = splatPly();
    const sparkPreview = {
      object: new Mesh(new BufferGeometry()),
      cleanupUrls: [],
      clips: [],
      formatVersion: null,
      assetKind: "gaussianSplat" as const,
    };
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.loadSparkPreviewObject.mockResolvedValue(sparkPreview);
    const { loadPlyPreviewObject } = await import("../loader");

    const result = await loadPlyPreviewObject(plyFile, { renderer });

    expect(mocks.loadSparkPreviewObject).toHaveBeenCalledWith(
      plyFile,
      { renderer },
      buffer,
    );
    expect(result).toBe(sparkPreview);
  });
});
