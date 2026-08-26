import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
  TextureLoader,
} from "three";
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

const objFile: SelectedFile = {
  extension: "obj",
  fileName: "asset.obj",
  kind: "model",
  parentDirectory: "C:\\assets",
  path: "C:\\assets\\asset.obj",
};

function encoded(text: string) {
  return new TextEncoder().encode(text).buffer;
}

function objText() {
  return `o Triangle
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
}

function buildGroup() {
  const group = new Group();
  group.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
  return group;
}

function mockObjOnlyRead() {
  mocks.readBinaryFile.mockImplementation((path: string) => {
    if (path === objFile.path) {
      return Promise.resolve(encoded(objText()));
    }
    return Promise.reject(new Error(`missing texture: ${path}`));
  });
}

describe("loadObjPreviewObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockObjOnlyRead();
  });

  it("loads OBJ files through the model parse worker", async () => {
    const object = buildGroup();
    const signal = new AbortController().signal;
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadObjPreviewObject } = await import("../loader");

    const result = await loadObjPreviewObject(objFile, {
      parseTimeoutMs: 123,
      signal,
    });

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      objFile.path,
      { kind: "obj", text: objText() },
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

  it("falls back to the main thread OBJ parser when the worker fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    const { loadObjPreviewObject } = await import("../loader");

    const result = await loadObjPreviewObject(objFile, {});

    expect(result.object).toBeInstanceOf(Group);
    expect((result.object as Group).children.length).toBeGreaterThan(0);
    expect(result).toMatchObject({
      cleanupUrls: [],
      clips: [],
      formatVersion: null,
    });
    expect(result.assetKind).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[obj] worker parse failed, falling back to main thread:",
      expect.any(Error),
    );
  });

  it("does not fall back when the worker reports abort or timeout", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mocks.parseModelInWorker.mockRejectedValue(abortError);
    const { loadObjPreviewObject } = await import("../loader");

    await expect(loadObjPreviewObject(objFile, {})).rejects.toBe(abortError);
  });

  it("reports decode, resolve, and scene stages in order", async () => {
    const onStage = vi.fn();
    mocks.parseModelInWorker.mockResolvedValue(buildGroup());
    const { loadObjPreviewObject } = await import("../loader");

    await loadObjPreviewObject(objFile, { onStage });

    expect(onStage).toHaveBeenNthCalledWith(1, "decode");
    expect(onStage).toHaveBeenNthCalledWith(2, "resolve");
    expect(onStage).toHaveBeenNthCalledWith(3, "scene");
  });

  it("loads adjacent PBR texture candidates and applies them to OBJ meshes", async () => {
    const texture = new Texture<HTMLImageElement>();
    const object = buildGroup();
    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:asset_A.png");
    const loadTextureSpy = vi
      .spyOn(TextureLoader.prototype, "loadAsync")
      .mockResolvedValue(texture);
    mocks.readBinaryFile.mockImplementation((path: string) => {
      if (path === objFile.path) {
        return Promise.resolve(encoded(objText()));
      }
      if (path === "C:\\assets\\asset_A.png") {
        return Promise.resolve(new ArrayBuffer(4));
      }
      return Promise.reject(new Error(`missing texture: ${path}`));
    });
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadObjPreviewObject } = await import("../loader");

    const result = await loadObjPreviewObject(objFile, {});
    const mesh = object.children[0] as Mesh;

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(loadTextureSpy).toHaveBeenCalledWith("blob:asset_A.png");
    expect(result.cleanupUrls).toEqual(["blob:asset_A.png"]);
    expect(texture.name).toBe("asset_A.png");
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
    expect((mesh.material as MeshStandardMaterial).map).toBe(texture);
  });

  it("revokes an object URL when adjacent texture decoding fails", async () => {
    const object = buildGroup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:broken-texture");
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockRejectedValue(
      new Error("decode failed"),
    );
    mocks.readBinaryFile.mockImplementation((path: string) => {
      if (path === objFile.path) {
        return Promise.resolve(encoded(objText()));
      }
      if (path === "C:\\assets\\asset_A.png") {
        return Promise.resolve(new ArrayBuffer(4));
      }
      return Promise.reject(new Error(`missing texture: ${path}`));
    });
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadObjPreviewObject } = await import("../loader");

    const result = await loadObjPreviewObject(objFile, {});

    expect(result.cleanupUrls).toEqual([]);
    expect(revokeSpy).toHaveBeenCalledWith("blob:broken-texture");
  });
});
