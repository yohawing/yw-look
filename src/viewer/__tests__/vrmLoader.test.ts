import { beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SelectedFile } from "../../lib/files";

const mocks = vi.hoisted(() => ({
  parseAsync: vi.fn(),
  readBinaryFile: vi.fn(),
  registerFactory: vi.fn(),
  rotateVRM0: vi.fn(),
}));

vi.mock("../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/files")>()),
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

import { loadPreviewObject } from "../loaders";

const vrmFile: SelectedFile = {
  path: "C:\\avatars\\sample.vrm",
  fileName: "sample.vrm",
  extension: "vrm",
  kind: "model",
  parentDirectory: "C:\\avatars",
};

describe("VRM preview loader", () => {
  beforeEach(() => {
    mocks.parseAsync.mockReset();
    mocks.readBinaryFile.mockReset();
    mocks.registerFactory.mockClear();
    mocks.rotateVRM0.mockClear();
    mocks.readBinaryFile.mockResolvedValue([0, 1, 2, 3]);
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

    const result = await loadPreviewObject(vrmFile, undefined, {
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

    await expect(loadPreviewObject(vrmFile)).rejects.toThrow(
      "no VRM extension data was found",
    );
  });
});
