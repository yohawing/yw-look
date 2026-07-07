import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  type WebGLRenderer,
} from "three";
import { ensureVertexNormals } from "../../../workers/modelParse.worker";
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

function meshPlyWithNormals() {
  return encoded(`ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property float nx
property float ny
property float nz
element face 1
property list uchar int vertex_indices
end_header
0 0 0 0 0 1
1 0 0 0 0 1
0 1 0 0 0 1
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

  it("skips normal recomputation in the worker when normals already exist", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    geometry.setAttribute(
      "normal",
      new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    );
    const computeSpy = vi.spyOn(geometry, "computeVertexNormals");

    ensureVertexNormals(geometry);

    expect(computeSpy).not.toHaveBeenCalled();
    computeSpy.mockRestore();
  });

  it("recomputes normals in the worker when normals are missing", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    const computeSpy = vi.spyOn(geometry, "computeVertexNormals");

    ensureVertexNormals(geometry);

    expect(computeSpy).toHaveBeenCalledTimes(1);
    computeSpy.mockRestore();
  });

  it("recomputes normals in the fallback path when mesh PLY has no normal attribute", async () => {
    const buffer = meshPly();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    const computeSpy = vi.spyOn(geometry, "computeVertexNormals");
    vi.doMock("three/examples/jsm/loaders/PLYLoader.js", () => ({
      PLYLoader: class {
        parse() {
          return geometry;
        }
      },
    }));
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    const { loadPlyPreviewObject } = await import("../loader");

    await loadPlyPreviewObject(plyFile, {});

    expect(computeSpy).toHaveBeenCalledTimes(1);
    computeSpy.mockRestore();
    warnSpy.mockRestore();
    vi.doUnmock("three/examples/jsm/loaders/PLYLoader.js");
    vi.resetModules();
  });

  it("skips normal recomputation in the fallback path when mesh PLY already has normals", async () => {
    const buffer = meshPlyWithNormals();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    geometry.setAttribute(
      "normal",
      new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    );
    const computeSpy = vi.spyOn(geometry, "computeVertexNormals");
    vi.doMock("three/examples/jsm/loaders/PLYLoader.js", () => ({
      PLYLoader: class {
        parse() {
          return geometry;
        }
      },
    }));
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    const { loadPlyPreviewObject } = await import("../loader");

    await loadPlyPreviewObject(plyFile, {});

    expect(computeSpy).not.toHaveBeenCalled();
    computeSpy.mockRestore();
    warnSpy.mockRestore();
    vi.doUnmock("three/examples/jsm/loaders/PLYLoader.js");
    vi.resetModules();
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
