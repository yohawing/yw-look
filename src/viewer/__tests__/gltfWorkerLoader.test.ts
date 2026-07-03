import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimationClip, Group, NumberKeyframeTrack } from "three";
import type { SelectedFile } from "../../lib/files";

const mocks = vi.hoisted(() => ({
  parseAsync: vi.fn(),
  parseModelInWorker: vi.fn(),
  readBinaryFile: vi.fn(),
}));

vi.mock("../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("../modelParseWorker", () => ({
  isAbortOrTimeoutError: (error: unknown) =>
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError"),
  parseModelInWorker: mocks.parseModelInWorker,
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    constructor(readonly manager?: unknown) {}

    parseAsync(input: ArrayBuffer | string, path: string) {
      return mocks.parseAsync(input, path, this.manager);
    }
  },
}));

const glbFile: SelectedFile = {
  path: "C:\\assets\\BoxTextured.glb",
  fileName: "BoxTextured.glb",
  extension: "glb",
  kind: "model",
  parentDirectory: "C:\\assets",
};

const gltfFile: SelectedFile = {
  path: "C:\\assets\\Duck.gltf",
  fileName: "Duck.gltf",
  extension: "gltf",
  kind: "model",
  parentDirectory: "C:\\assets",
};

const clip = new AnimationClip("Walk", 1, [
  new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
]);

function encoded(text: string) {
  return new TextEncoder().encode(text).buffer;
}

describe("glTF/GLB worker preview loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBinaryFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".gltf")) {
        return encoded(
          JSON.stringify({
            asset: { version: "2.0" },
            buffers: [{ uri: "Duck.bin" }],
            images: [{ uri: "Duck.png" }],
          }),
        );
      }
      return new Uint8Array([0, 1, 2, 3]).buffer;
    });
  });

  it("loads GLB through the model parse worker and keeps animation clips", async () => {
    const scene = new Group();
    scene.animations = [clip];
    mocks.parseModelInWorker.mockResolvedValue(scene);

    const { loadPreviewObject } = await import("../loaders");
    const result = await loadPreviewObject(glbFile);

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      glbFile.path,
      { kind: "glb", buffer: expect.any(ArrayBuffer) },
      { signal: undefined, timeoutMs: undefined },
    );
    expect(mocks.parseAsync).not.toHaveBeenCalled();
    expect(result.object).toBe(scene);
    expect(result.clips).toEqual([clip]);
  });

  it("falls back to main-thread GLB parsing for small worker failures", async () => {
    const scene = new Group();
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    mocks.parseAsync.mockResolvedValue({ scene, animations: [clip] });

    const { loadPreviewObject } = await import("../loaders");
    const result = await loadPreviewObject(glbFile);

    expect(mocks.parseAsync).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "",
      undefined,
    );
    expect(result.object).toBe(scene);
    expect(result.clips).toEqual([clip]);
  });

  it("passes materialized external glTF resources to the worker", async () => {
    const scene = new Group();
    mocks.parseModelInWorker.mockResolvedValue(scene);

    const { loadPreviewObject } = await import("../loaders");
    const result = await loadPreviewObject(gltfFile);

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      gltfFile.path,
      {
        kind: "gltf",
        text: expect.stringContaining('"asset"'),
        resourceUrls: {
          "Duck.bin": expect.stringMatching(/^blob:/),
          "Duck.png": expect.stringMatching(/^blob:/),
        },
      },
      { signal: undefined, timeoutMs: undefined },
    );
    expect(mocks.parseAsync).not.toHaveBeenCalled();
    expect(result.object).toBe(scene);
    expect(result.cleanupUrls).toEqual([
      expect.stringMatching(/^blob:/),
      expect.stringMatching(/^blob:/),
    ]);
  });
});
