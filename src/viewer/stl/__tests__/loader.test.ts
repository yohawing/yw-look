import { beforeEach, describe, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, Mesh } from "three";
import { ensureVertexNormals } from "../../../workers/modelParse.worker";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
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

const stlFile: SelectedFile = {
  extension: "stl",
  fileName: "asset.stl",
  kind: "model",
  parentDirectory: "C:\\assets",
  path: "C:\\assets\\asset.stl",
};

function asciiStl() {
  return new TextEncoder().encode(`solid triangle
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid triangle
`).buffer;
}

describe("loadStlPreviewObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads STL files through the model parse worker", async () => {
    const object = new Mesh(new BufferGeometry());
    const buffer = asciiStl();
    const signal = new AbortController().signal;
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadStlPreviewObject } = await import("../loader");

    const result = await loadStlPreviewObject(stlFile, {
      parseTimeoutMs: 123,
      signal,
    });

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      stlFile.path,
      { kind: "stl", buffer },
      { signal, timeoutMs: 123 },
    );
    expect(result).toMatchObject({
      object,
      cleanupUrls: [],
      clips: [],
      formatVersion: null,
    });
    expect(result.assetKind).toBeUndefined();
  });

  it("falls back to the main thread STL parser when the worker fails", async () => {
    const buffer = asciiStl();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    const { loadStlPreviewObject } = await import("../loader");

    const result = await loadStlPreviewObject(stlFile, {});

    expect(result.object).toBeInstanceOf(Mesh);
    expect((result.object as Mesh).geometry.attributes.position.count).toBe(3);
    expect(result).toMatchObject({
      cleanupUrls: [],
      clips: [],
      formatVersion: null,
    });
    expect(result.assetKind).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[stl] worker parse failed, falling back to main thread:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("does not fall back when the worker reports abort or timeout", async () => {
    const buffer = asciiStl();
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockRejectedValue(abortError);
    const { loadStlPreviewObject } = await import("../loader");

    await expect(loadStlPreviewObject(stlFile, {})).rejects.toBe(abortError);
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

  it("skips normal recomputation in the fallback path when STL already has normals", async () => {
    const buffer = asciiStl();
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
    vi.doMock("three/examples/jsm/loaders/STLLoader.js", () => ({
      STLLoader: class {
        parse() {
          return geometry;
        }
      },
    }));
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    const { loadStlPreviewObject } = await import("../loader");

    await loadStlPreviewObject(stlFile, {});

    expect(computeSpy).not.toHaveBeenCalled();
    computeSpy.mockRestore();
    warnSpy.mockRestore();
    vi.doUnmock("three/examples/jsm/loaders/STLLoader.js");
    vi.resetModules();
  });

  it("reports decode and scene stages before parsing", async () => {
    const object = new Mesh(new BufferGeometry());
    const onStage = vi.fn();
    mocks.readBinaryFile.mockResolvedValue(asciiStl());
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadStlPreviewObject } = await import("../loader");

    await loadStlPreviewObject(stlFile, { onStage });

    expect(onStage).toHaveBeenNthCalledWith(1, "decode");
    expect(onStage).toHaveBeenNthCalledWith(2, "scene");
    expect(mocks.parseModelInWorker).toHaveBeenCalledTimes(1);
  });
});
