import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  Texture,
} from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  parse: vi.fn(),
  readBinaryFile: vi.fn(),
  setLibraryPath: vi.fn(),
  setWorkerLimit: vi.fn(),
  libraryPending: null as Promise<unknown> | null,
  workerPool: [] as unknown[],
  workerSourceURL: "",
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("three/examples/jsm/loaders/3DMLoader.js", () => ({
  Rhino3dmLoader: class {
    libraryPending: Promise<unknown> | null = mocks.libraryPending;
    workerPool: unknown[] = mocks.workerPool;
    workerSourceURL = mocks.workerSourceURL;

    setLibraryPath(path: string) {
      mocks.setLibraryPath(path);
      return this;
    }

    setWorkerLimit(limit: number) {
      mocks.setWorkerLimit(limit);
      return this;
    }

    parse(
      buffer: ArrayBuffer,
      onLoad: (object: Object3D) => void,
      onError: (error: unknown) => void,
    ) {
      return mocks.parse(buffer, onLoad, onError);
    }

    dispose() {
      mocks.dispose();
      return this;
    }
  },
}));

vi.mock("virtual:yw-look-rhino3dm-library-path", () => ({
  default: "/rhino3dm/",
}));

import { loadRhino3dmPreviewObject } from "../loader";

const rhinoFile: SelectedFile = {
  path: "C:\\models\\sample.3dm",
  fileName: "sample.3dm",
  extension: "3dm",
  kind: "model",
  parentDirectory: "C:\\models",
};

describe("loadRhino3dmPreviewObject", () => {
  beforeEach(() => {
    mocks.dispose.mockReset();
    mocks.parse.mockReset();
    mocks.readBinaryFile.mockReset();
    mocks.setLibraryPath.mockReset();
    mocks.setWorkerLimit.mockReset();
    mocks.libraryPending = null;
    mocks.workerPool = [];
    mocks.workerSourceURL = "";
    mocks.readBinaryFile.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  });

  it("reads, parses, wraps the root, returns warnings, and disposes the loader", async () => {
    const root = new Group();
    root.name = "Rhino root";
    root.userData.warnings = [
      { message: "Missing embedded texture", type: "missing resource" },
      { message: "Unsupported decal", type: "no conversion" },
    ];
    mocks.parse.mockImplementationOnce(
      (_buffer: ArrayBuffer, onLoad: (object: Object3D) => void) =>
        onLoad(root),
    );
    const warnings: string[] = [];
    const stages: string[] = [];

    const result = await loadRhino3dmPreviewObject(rhinoFile, {
      onStage: (stage) => stages.push(stage),
      onWarning: (warning) => warnings.push(warning),
    });

    expect(mocks.readBinaryFile).toHaveBeenCalledWith(rhinoFile.path);
    expect(mocks.parse).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.any(Function),
      expect.any(Function),
    );
    expect(mocks.setLibraryPath).toHaveBeenCalledWith("/rhino3dm/");
    expect(mocks.setWorkerLimit).toHaveBeenCalledWith(1);
    expect(result.object).toBeInstanceOf(Group);
    expect(result.object.name).toBe("Rhino root");
    expect(result.object.children).toEqual([root]);
    expect(result.clips).toEqual([]);
    expect(result.formatVersion).toBeNull();
    expect(result.assetKind).toBe("mesh");
    expect(result.warnings).toEqual([
      "Missing embedded texture",
      "Unsupported decal",
    ]);
    expect(warnings).toEqual([]);
    expect(stages).toEqual(["scan", "decode", "scene"]);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("cleans shared line, points, and sprite resources once on success", async () => {
    const meshGeometry = new BufferGeometry();
    const sharedLineGeometry = new BufferGeometry();
    const texture = new Texture();
    const meshMaterial = new MeshBasicMaterial();
    const spriteMaterial = new SpriteMaterial({ map: texture });
    const lineMaterial = new LineBasicMaterial({ map: texture });
    const pointsMaterial = new PointsMaterial({ map: texture });
    const root = new Group();
    root.add(
      new Mesh(meshGeometry, meshMaterial),
      new Line(sharedLineGeometry, lineMaterial),
      new Points(sharedLineGeometry, pointsMaterial),
      new Sprite(spriteMaterial),
    );
    const meshGeometryDispose = vi.spyOn(meshGeometry, "dispose");
    const sharedLineGeometryDispose = vi.spyOn(sharedLineGeometry, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const meshMaterialDispose = vi.spyOn(meshMaterial, "dispose");
    const spriteMaterialDispose = vi.spyOn(spriteMaterial, "dispose");
    const lineMaterialDispose = vi.spyOn(lineMaterial, "dispose");
    const pointsMaterialDispose = vi.spyOn(pointsMaterial, "dispose");
    mocks.parse.mockImplementationOnce(
      (_buffer: ArrayBuffer, onLoad: (object: Object3D) => void) =>
        onLoad(root),
    );

    const result = await loadRhino3dmPreviewObject(rhinoFile, {});
    const cleanup = result.cleanupCallbacks?.[0];
    expect(cleanup).toBeDefined();
    cleanup?.();
    cleanup?.();

    expect(meshGeometryDispose).not.toHaveBeenCalled();
    expect(sharedLineGeometryDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(meshMaterialDispose).not.toHaveBeenCalled();
    expect(spriteMaterialDispose).toHaveBeenCalledOnce();
    expect(lineMaterialDispose).toHaveBeenCalledOnce();
    expect(pointsMaterialDispose).toHaveBeenCalledOnce();
  });

  it("wraps parser failures and disposes the loader", async () => {
    mocks.parse.mockImplementationOnce(
      (
        _buffer: ArrayBuffer,
        _onLoad: (object: Object3D) => void,
        onError: (error: unknown) => void,
      ) => onError(new Error("corrupt 3DM payload")),
    );

    await expect(loadRhino3dmPreviewObject(rhinoFile, {})).rejects.toThrow(
      "Unable to load Rhino 3DM preview: corrupt 3DM payload",
    );
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("disposes the loader when aborted before reading", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("terminates the parse and disposes the loader when aborted in flight", async () => {
    const controller = new AbortController();
    const pending = loadRhino3dmPreviewObject(rhinoFile, {
      signal: controller.signal,
    });
    await Promise.resolve();
    expect(mocks.parse).toHaveBeenCalledOnce();

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("closes an abort that races listener registration before parsing starts", async () => {
    const raceState = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    raceState.addEventListener.mockImplementation(() => {
      raceState.aborted = true;
    });
    const raceSignal = raceState as unknown as AbortSignal;

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, { signal: raceSignal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(raceState.addEventListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
      { once: true },
    );
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("cleans all parsed resources when abort follows parse success", async () => {
    const geometry = new BufferGeometry();
    const texture = new Texture();
    const meshMaterial = new MeshBasicMaterial({ map: texture });
    const root = new Group().add(new Mesh(geometry, meshMaterial));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const materialDispose = vi.spyOn(meshMaterial, "dispose");
    const controller = new AbortController();
    mocks.parse.mockImplementationOnce(
      (_buffer: ArrayBuffer, onLoad: (object: Object3D) => void) => {
        onLoad(root);
        controller.abort();
      },
    );

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("disposes a worker created after a timed-out library initialization", async () => {
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    let resolveLibrary!: () => void;
    mocks.libraryPending = new Promise<void>((resolve) => {
      resolveLibrary = resolve;
    });
    mocks.workerSourceURL = "blob:rhino-worker";
    mocks.parse.mockImplementationOnce(() => undefined);

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, { parseTimeoutMs: 5 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(mocks.dispose).toHaveBeenCalledOnce();

    mocks.workerPool.push({});
    resolveLibrary();
    await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledTimes(2));
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:rhino-worker");
  });

  it("absorbs a rejected library initialization after timeout", async () => {
    let rejectLibrary!: (error: Error) => void;
    mocks.libraryPending = new Promise((_, reject) => {
      rejectLibrary = reject;
    });
    mocks.parse.mockImplementationOnce(() => undefined);

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, { parseTimeoutMs: 5 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    rejectLibrary(new Error("rhino library unavailable"));
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("rejects with TimeoutError and disposes the loader when parsing exceeds the timeout", async () => {
    mocks.parse.mockImplementationOnce(() => undefined);

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, { parseTimeoutMs: 5 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
