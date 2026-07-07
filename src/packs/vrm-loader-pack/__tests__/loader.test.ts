import { beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  parseAsync: vi.fn(),
  readBinaryFile: vi.fn(),
  registerFactory: vi.fn(),
  rotateVRM0: vi.fn(),
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    register(factory: (parser: object) => object) {
      mocks.registerFactory(factory({}));
    }

    parseAsync(buffer: ArrayBuffer, path: string) {
      return mocks.parseAsync(buffer, path);
    }
  },
}));

vi.mock("@pixiv/three-vrm", () => ({
  VRMLoaderPlugin: class {
    constructor(readonly parser: object) {}
  },
  VRMUtils: {
    rotateVRM0: mocks.rotateVRM0,
  },
}));

import { loadVrmPreviewObject } from "../loader";

const vrmFile: SelectedFile = {
  path: "C:\\avatars\\sample.vrm",
  fileName: "sample.vrm",
  extension: "vrm",
  kind: "model",
  parentDirectory: "C:\\avatars",
};

describe("loadVrmPreviewObject", () => {
  beforeEach(() => {
    mocks.parseAsync.mockReset();
    mocks.readBinaryFile.mockReset();
    mocks.registerFactory.mockClear();
    mocks.rotateVRM0.mockClear();
    mocks.readBinaryFile.mockResolvedValue(new Uint8Array([0, 1, 2, 3]).buffer);
  });

  it("registers the VRM loader plugin and returns the VRM scene", async () => {
    const scene = new Group();
    const vrm = {
      scene,
      meta: {
        name: "Mock Avatar",
        metaVersion: undefined,
      },
      update: vi.fn(),
    };
    const animations: [] = [];
    const stages: string[] = [];

    mocks.parseAsync.mockResolvedValue({
      userData: { vrm },
      animations,
    });

    const result = await loadVrmPreviewObject(vrmFile, {
      onStage: (stage) => stages.push(stage),
    });

    expect(mocks.registerFactory).toHaveBeenCalledOnce();
    expect(mocks.parseAsync).toHaveBeenCalledWith(expect.any(ArrayBuffer), "");
    expect(mocks.rotateVRM0).toHaveBeenCalledWith(vrm);
    expect(scene.name).toBe("Mock Avatar");
    expect(scene.userData.vrm).toBe(vrm);
    expect(result).toEqual({
      object: scene,
      cleanupUrls: [],
      clips: animations,
      formatVersion: "VRM unknown",
    });
    expect(stages).toEqual(["scan", "decode", "gpu", "scene"]);
  });

  it("fails with a readable error when a glTF-like file has no VRM data", async () => {
    mocks.parseAsync.mockResolvedValue({
      userData: {},
      animations: [],
    });

    await expect(loadVrmPreviewObject(vrmFile, {})).rejects.toThrow(
      "Unable to load VRM preview: The file loaded as glTF, but no VRM extension data was found.",
    );
  });

  it("rejects with AbortError before file read when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadVrmPreviewObject(vrmFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it("rejects with AbortError after file read when aborted before parseAsync", async () => {
    const controller = new AbortController();
    mocks.readBinaryFile.mockImplementation(async () => {
      controller.abort();
      return new Uint8Array([0, 1, 2, 3]).buffer;
    });

    await expect(
      loadVrmPreviewObject(vrmFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it("rejects with AbortError after parseAsync when aborted and does not mutate the scene", async () => {
    const scene = new Group();
    const vrm = {
      scene,
      meta: {
        name: "Mock Avatar",
        metaVersion: undefined,
      },
      update: vi.fn(),
    };
    const controller = new AbortController();

    mocks.parseAsync.mockImplementation(async () => {
      controller.abort();
      return {
        userData: { vrm },
        animations: [],
      };
    });

    await expect(
      loadVrmPreviewObject(vrmFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.rotateVRM0).not.toHaveBeenCalled();
    expect(scene.name).toBe("");
    expect(scene.userData.vrm).toBeUndefined();
  });
});
