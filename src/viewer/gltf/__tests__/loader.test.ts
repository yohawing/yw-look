import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimationClip, Group, NumberKeyframeTrack } from "three";
import type { SelectedFile } from "../../../lib/files";
import { formatMissingTextureWarnings } from "../../textureWarnings";
import {
  applyMissingGltfTextureFallbacks,
  getMimeType,
  loadGltfPreviewObject,
  mapWithConcurrency,
  resolveSiblingPath,
  type GltfDocument,
} from "../loader";

const mocks = vi.hoisted(() => ({
  parseAsync: vi.fn(),
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

function defaultGltfDocument() {
  return JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ uri: "Duck.bin" }],
    images: [{ uri: "Duck.png" }],
  });
}

describe("getMimeType", () => {
  it("returns expected MIME types for preview resources", () => {
    expect(getMimeType("png")).toBe("image/png");
    expect(getMimeType("jpg")).toBe("image/jpeg");
    expect(getMimeType("jpeg")).toBe("image/jpeg");
    expect(getMimeType("tga")).toBe("image/x-tga");
    expect(getMimeType("dds")).toBe("image/vnd-ms.dds");
    expect(getMimeType("hdr")).toBe("image/vnd.radiance");
    expect(getMimeType("exr")).toBe("image/x-exr");
    expect(getMimeType("ktx2")).toBe("image/ktx2");
    expect(getMimeType("bmp")).toBe("image/bmp");
    expect(getMimeType("bin")).toBe("application/octet-stream");
    expect(getMimeType("xyz")).toBe("application/octet-stream");
    expect(getMimeType("")).toBe("application/octet-stream");
  });
});

describe("resolveSiblingPath", () => {
  it("resolves sibling paths across Unix and Windows bases", () => {
    expect(resolveSiblingPath("/home/user/models", "texture.png")).toBe(
      "/home/user/models/texture.png",
    );
    expect(resolveSiblingPath("C:\\Users\\user\\models", "texture.png")).toBe(
      "C:\\Users\\user\\models\\texture.png",
    );
    expect(resolveSiblingPath("/home/user/models/sub", "../texture.png")).toBe(
      "/home/user/models/texture.png",
    );
    expect(
      resolveSiblingPath("C:\\Users\\user\\models\\sub", "../texture.png"),
    ).toBe("C:\\Users\\user\\models\\texture.png");
    expect(resolveSiblingPath("/home/user/models", "./texture.png")).toBe(
      "/home/user/models/texture.png",
    );
    expect(resolveSiblingPath("/home/user/models", "textures/color.png")).toBe(
      "/home/user/models/textures/color.png",
    );
    expect(resolveSiblingPath("C:\\Users/user\\models", "texture.png")).toBe(
      "C:\\Users\\user\\models\\texture.png",
    );
  });

  it("throws on path traversal beyond filesystem root", () => {
    expect(() => resolveSiblingPath("/home", "../../etc/passwd")).toThrow(
      "Path traversal beyond filesystem root",
    );
  });
});

describe("glTF missing texture fallback helpers", () => {
  it("replaces glTF materials that reference missing images with a fallback material", () => {
    const json: GltfDocument = {
      images: [{ uri: "missing.png" }, { uri: "present.png" }],
      textures: [{ source: 0 }, { source: 1 }],
      materials: [
        {
          name: "Broken",
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
            baseColorFactor: [1, 0, 0, 1] as [number, number, number, number],
          },
          normalTexture: { index: 1 },
        },
        {
          name: "Intact",
          pbrMetallicRoughness: {
            baseColorTexture: { index: 1 },
          },
        },
      ],
    };

    applyMissingGltfTextureFallbacks(json, new Set([0]));
    const materials = json.materials!;

    expect(materials[0].pbrMetallicRoughness).toEqual({
      baseColorFactor: [0.78, 0.82, 0.9, 1],
      metallicFactor: 0,
      roughnessFactor: 0.72,
    });
    expect(materials[0].normalTexture).toBeUndefined();
    expect(materials[1].pbrMetallicRoughness).toEqual({
      baseColorTexture: { index: 1 },
    });
  });

  it("removes missing normal, emissive, and extension texture slots", () => {
    const json: GltfDocument = {
      images: [{ uri: "missing-clearcoat.png" }],
      textures: [{ source: 0 }],
      materials: [
        {
          normalTexture: { index: 0 },
          emissiveTexture: { index: 0 },
          extensions: {
            KHR_materials_clearcoat: {
              clearcoatTexture: { index: 0 },
            },
          },
        },
        {
          extensions: {
            EXT_example: {
              variantIndex: { index: 0 },
            },
          },
        },
      ],
    };

    applyMissingGltfTextureFallbacks(json, new Set([0]));

    expect(json.materials![0].pbrMetallicRoughness).toEqual({
      baseColorFactor: [0.78, 0.82, 0.9, 1],
      metallicFactor: 0,
      roughnessFactor: 0.72,
    });
    expect(json.materials![0].normalTexture).toBeUndefined();
    expect(json.materials![0].emissiveTexture).toBeUndefined();
    expect(json.materials![0].extensions).toBeUndefined();
    expect(json.materials![1].pbrMetallicRoughness).toBeUndefined();
    expect(json.materials![1].extensions).toEqual({
      EXT_example: {
        variantIndex: { index: 0 },
      },
    });
  });

  it("formats missing texture warnings with a bounded path list", () => {
    expect(
      formatMissingTextureWarnings([
        "a.png",
        "b.png",
        "c.png",
        "d.png",
        "e.png",
        "f.png",
      ]),
    ).toEqual([
      "Missing texture references: a.png, b.png, c.png, d.png, e.png, +1 more. Fallback material was used.",
    ]);
  });
});

describe("mapWithConcurrency", () => {
  it("returns mapped values in input order", async () => {
    const result = await mapWithConcurrency(["a", "b", "c"], 4, async (item) =>
      item.toUpperCase(),
    );
    expect(result).toEqual(["A", "B", "C"]);
  });

  it("returns an empty array for empty input", async () => {
    await expect(
      mapWithConcurrency([], 4, async (item) => item),
    ).resolves.toEqual([]);
  });

  it("limits concurrent mapper invocations", async () => {
    let active = 0;
    let maxActive = 0;
    const releaseResolvers: Array<() => void> = [];

    const mapper = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        releaseResolvers.push(resolve);
      });
      active -= 1;
    });

    const pending = mapWithConcurrency(
      Array.from({ length: 8 }, (_, index) => index),
      4,
      mapper,
    );

    await vi.waitFor(() => expect(mapper).toHaveBeenCalledTimes(4));

    while (releaseResolvers.length > 0) {
      releaseResolvers.shift()?.();
      await Promise.resolve();
    }

    await pending;

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(mapper).toHaveBeenCalledTimes(8);
  });
});

describe("loadGltfPreviewObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mocks.readBinaryFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".gltf")) {
        return encoded(defaultGltfDocument());
      }
      return new Uint8Array([0, 1, 2, 3]).buffer;
    });
    let objectUrlIndex = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:${objectUrlIndex++}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("loads GLB through the model parse worker and keeps animation clips", async () => {
    const scene = new Group();
    scene.animations = [clip];
    mocks.parseModelInWorker.mockResolvedValue(scene);

    const result = await loadGltfPreviewObject(glbFile, {});

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      glbFile.path,
      { kind: "glb", buffer: expect.any(ArrayBuffer) },
      { signal: undefined, timeoutMs: undefined },
    );
    expect(mocks.parseAsync).not.toHaveBeenCalled();
    expect(result.object).toBe(scene);
    expect(result.clips).toEqual([clip]);
    expect(result.cleanupUrls).toEqual([]);
  });

  it("falls back to main-thread GLB parsing for small worker failures", async () => {
    const scene = new Group();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    mocks.parseAsync.mockResolvedValue({ scene, animations: [clip] });

    const result = await loadGltfPreviewObject(glbFile, {});

    expect(mocks.parseAsync).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "",
      undefined,
    );
    expect(result.object).toBe(scene);
    expect(result.clips).toEqual([clip]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[glb] worker parse failed, falling back to main thread:",
      expect.any(Error),
    );
  });

  it("does not fall back when the GLB worker reports abort", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mocks.parseModelInWorker.mockRejectedValue(abortError);

    await expect(loadGltfPreviewObject(glbFile, {})).rejects.toBe(abortError);
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it("does not fall back when the GLB worker reports timeout", async () => {
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    mocks.parseModelInWorker.mockRejectedValue(timeoutError);

    await expect(loadGltfPreviewObject(glbFile, {})).rejects.toBe(timeoutError);
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it("fails closed for large GLB worker failures", async () => {
    mocks.readBinaryFile.mockResolvedValue(new ArrayBuffer(50 * 1024 * 1024));
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));

    await expect(loadGltfPreviewObject(glbFile, {})).rejects.toThrow(
      "Worker parsing failed for large file",
    );
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it("passes materialized external glTF resources to the worker", async () => {
    const scene = new Group();
    mocks.parseModelInWorker.mockResolvedValue(scene);

    const result = await loadGltfPreviewObject(gltfFile, {});

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      gltfFile.path,
      {
        kind: "gltf",
        text: expect.stringContaining('"asset"'),
        resourceUrls: {
          "Duck.bin": "blob:0",
          "Duck.png": "blob:1",
        },
      },
      { signal: undefined, timeoutMs: undefined },
    );
    expect(mocks.parseAsync).not.toHaveBeenCalled();
    expect(result.object).toBe(scene);
    expect(result.cleanupUrls).toEqual(["blob:0", "blob:1"]);
    expect(result.warnings).toEqual([]);
  });

  it("falls back to main-thread glTF parsing for small worker failures", async () => {
    const scene = new Group();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    mocks.parseAsync.mockResolvedValue({ scene, animations: [clip] });

    const result = await loadGltfPreviewObject(gltfFile, {});

    expect(mocks.parseAsync).toHaveBeenCalledWith(
      expect.stringContaining('"asset"'),
      "",
      expect.objectContaining({
        setURLModifier: expect.any(Function),
      }),
    );
    expect(result.object).toBe(scene);
    expect(result.clips).toEqual([clip]);
    expect(result.cleanupUrls).toEqual(["blob:0", "blob:1"]);
    expect(result.formatVersion).toBe("2.0");
    expect(warnSpy).toHaveBeenCalledWith(
      "[gltf] worker parse failed, falling back to main thread:",
      expect.any(Error),
    );
  });

  it("does not fall back when the glTF worker reports abort", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mocks.parseModelInWorker.mockRejectedValue(abortError);

    await expect(loadGltfPreviewObject(gltfFile, {})).rejects.toBe(abortError);
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it("does not fall back when the glTF worker reports timeout", async () => {
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    mocks.parseModelInWorker.mockRejectedValue(timeoutError);

    await expect(loadGltfPreviewObject(gltfFile, {})).rejects.toBe(
      timeoutError,
    );
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it("reports glTF missing images as warnings while preserving load success", async () => {
    const scene = new Group();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.parseModelInWorker.mockResolvedValue(scene);
    mocks.readBinaryFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".gltf")) {
        return encoded(
          JSON.stringify({
            asset: { version: "2.0" },
            buffers: [{ uri: "Duck.bin" }],
            images: [{ uri: "Missing.png" }],
          }),
        );
      }
      if (path.endsWith("Duck.bin")) {
        return new Uint8Array([0, 1, 2, 3]).buffer;
      }
      throw new Error(`missing file: ${path}`);
    });

    const result = await loadGltfPreviewObject(gltfFile, {});

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      gltfFile.path,
      expect.objectContaining({
        resourceUrls: {
          "Duck.bin": "blob:0",
          "Missing.png": expect.stringMatching(/^data:image\/png;base64,/),
        },
      }),
      expect.any(Object),
    );
    expect(result.cleanupUrls).toEqual(["blob:0"]);
    expect(result.warnings).toEqual([
      "Missing texture reference: Missing.png. Fallback material was used.",
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[gltf] missing texture references; using fallback material:",
      {
        file: "Duck.gltf",
        missingTextures: ["Missing.png"],
      },
    );
  });

  it("throws MissingReferenceError fields and revokes created blobs for missing glTF buffers", async () => {
    mocks.readBinaryFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".gltf")) {
        return encoded(
          JSON.stringify({
            asset: { version: "2.0" },
            buffers: [{ uri: "Missing.bin" }],
            images: [{ uri: "Present.png" }],
          }),
        );
      }
      if (path.endsWith("Present.png")) {
        return new Uint8Array([0, 1, 2, 3]).buffer;
      }
      throw new Error(`missing file: ${path}`);
    });

    await expect(loadGltfPreviewObject(gltfFile, {})).rejects.toMatchObject({
      formatVersion: "2.0",
      missingPaths: ["Missing.bin"],
      unresolvedImages: [],
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:0");
    expect(mocks.parseModelInWorker).not.toHaveBeenCalled();
  });

  it("fails closed for large glTF worker failures", async () => {
    const largeJson = JSON.stringify({
      asset: { version: "2.0" },
      extras: "x".repeat(50 * 1024 * 1024),
    });
    mocks.readBinaryFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".gltf")) {
        return encoded(largeJson);
      }
      return new Uint8Array([0, 1, 2, 3]).buffer;
    });
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));

    await expect(loadGltfPreviewObject(gltfFile, {})).rejects.toThrow(
      "Worker parsing failed for large file",
    );
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it("reports loader stages in order", async () => {
    const onStage = vi.fn();
    mocks.parseModelInWorker.mockResolvedValue(new Group());

    await loadGltfPreviewObject(glbFile, { onStage });
    expect(onStage).toHaveBeenNthCalledWith(1, "decode");
    expect(onStage).toHaveBeenNthCalledWith(2, "gpu");

    onStage.mockClear();
    await loadGltfPreviewObject(gltfFile, { onStage });
    expect(onStage).toHaveBeenNthCalledWith(1, "resolve");
    expect(onStage).toHaveBeenNthCalledWith(2, "gpu");
  });
});
