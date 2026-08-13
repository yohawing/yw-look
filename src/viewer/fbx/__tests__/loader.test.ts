import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Texture,
} from "three";
import type { SelectedFile } from "../../../lib/files";
import { FBXLoader } from "../../../vendor/FBXLoaderPatched.js";
import { formatMissingTextureWarnings } from "../../textureWarnings";
import {
  applyMissingTextureMaterialFallback,
  copyDecodedFbxTextureImage,
  createFbxPendingImageTexture,
  hydrateFbxDeferredTexturePlaceholders,
  registerFbxTextureMaterialFallbacks,
  resolveMissingTextureLabel,
} from "../loader";

const mocks = vi.hoisted(() => ({
  decodePsdFile: vi.fn(),
  parseModelInWorker: vi.fn(),
  readBinaryFile: vi.fn(),
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  decodePsdFile: mocks.decodePsdFile,
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("../../modelParseWorker", () => ({
  isAbortOrTimeoutError: (error: unknown) =>
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError"),
  parseModelInWorker: mocks.parseModelInWorker,
}));

function readFixtureArrayBuffer(...segments: string[]): ArrayBuffer {
  const bytes = readFileSync(resolve(process.cwd(), ...segments));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const WORKER_TRANSFER_SIZE_LIMIT = 50 * 1024 * 1024;

const fbxFile: SelectedFile = {
  extension: "fbx",
  fileName: "asset.fbx",
  kind: "model",
  parentDirectory: "C:\\assets",
  path: "C:\\assets\\asset.fbx",
};

describe("FBX animated public fixture", () => {
  it("parses animated-triangle.fbx with animation metadata", () => {
    const object = new FBXLoader().parse(
      readFixtureArrayBuffer("tests/fixtures/models/animated-triangle.fbx"),
      "",
    ) as Group;

    expect(object).toBeTruthy();
    expect(object.type).toBe("Group");
    expect(object.animations?.length).toBeGreaterThan(0);

    const clip = object.animations![0];
    expect(clip.name).toBe("FixtureTake");
    expect(clip.duration).toBeCloseTo(1);
    expect(clip.tracks.length).toBeGreaterThan(0);
    expect(clip.tracks[0].times[0]).toBeCloseTo(0);
    expect(clip.tracks[0].times.at(-1)).toBeCloseTo(1);
  });

  it("clips multiple takes to LocalTime and normalizes negative starts", () => {
    const object = new FBXLoader().parse(
      readFixtureArrayBuffer("tests/fixtures/models/animated-take-ranges.fbx"),
      "",
    ) as Group;

    const takeA = object.animations?.find((clip) => clip.name === "Take A");
    const takeB = object.animations?.find((clip) => clip.name === "Take B");

    expect(takeA).toBeTruthy();
    expect(takeA?.duration).toBeCloseTo(1);
    expect(Array.from(takeA!.tracks[0].times)).toEqual([0, 0.5, 1]);
    expect(Array.from(takeA!.tracks[0].values)).toEqual([
      0, 0, 0, 5, 0, 0, 10, 0, 0,
    ]);

    expect(takeB).toBeTruthy();
    expect(takeB?.duration).toBeCloseTo(1.5);
    expect(Array.from(takeB!.tracks[0].times)).toEqual([0, 1, 1.5]);
    expect(Array.from(takeB!.tracks[0].values)).toEqual([
      -10, 0, 0, 0, 0, 0, 5, 0, 0,
    ]);
  });
});

describe("FBX missing texture fallback", () => {
  it("keeps deferred raster textures on the regular GPU upload path", () => {
    const texture = createFbxPendingImageTexture("tex/albedo.png");

    expect(texture.isTexture).toBe(true);
    expect(
      (texture as Texture & { isDataTexture?: boolean }).isDataTexture,
    ).not.toBe(true);
    expect(texture.colorSpace).toBe("srgb");
    expect(texture.image).toBeNull();
  });

  it("copies decoded pixels without discarding FBX sampler transforms", () => {
    const target = createFbxPendingImageTexture("tex/albedo.png");
    target.offset.set(0.25, 0.5);
    target.repeat.set(2, -3);
    target.center.set(0.5, 0.5);
    target.rotation = 0.75;
    target.flipY = false;

    const source = new Texture({
      width: 4,
      height: 8,
    } as HTMLImageElement);
    source.offset.set(0, 0);
    source.repeat.set(1, 1);
    source.rotation = 0;
    source.flipY = true;

    copyDecodedFbxTextureImage(target, source);

    expect(target.image).toBe(source.image);
    expect(target.offset.toArray()).toEqual([0.25, 0.5]);
    expect(target.repeat.toArray()).toEqual([2, -3]);
    expect(target.center.toArray()).toEqual([0.5, 0.5]);
    expect(target.rotation).toBe(0.75);
    expect(target.flipY).toBe(false);
    expect(target.colorSpace).toBe("srgb");
    expect(target.version).toBeGreaterThan(1);
  });

  it("removes failed texture slots from registered materials", () => {
    const texture = new Texture();
    const material = new MeshStandardMaterial({
      map: texture,
      normalMap: texture,
      bumpMap: texture,
      metalness: 1,
      roughness: 0.1,
    });
    const mesh = new Mesh(new BufferGeometry(), material);

    registerFbxTextureMaterialFallbacks(mesh);
    applyMissingTextureMaterialFallback(texture);

    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    expect(material.bumpMap).toBeNull();
    expect(material.color.getHexString()).toBe("c7d2e3");
    expect(material.metalness).toBe(0.08);
    expect(material.roughness).toBe(0.72);
  });

  it("prefers source name over blob URL for missing texture warnings", () => {
    const texture = new Texture();
    texture.name = "source-name-from-texture-name.png";
    texture.userData.fbxSourceName = "Embedded/Texture_01.png";

    const label = resolveMissingTextureLabel(
      "blob:http://localhost/abc",
      texture,
    );

    expect(label).toBe("Texture_01.png");
    expect(formatMissingTextureWarnings([label])[0]).toContain(
      "Texture_01.png",
    );
  });

  it("falls back to texture name for blob missing texture warnings", () => {
    const texture = new Texture();
    texture.name = "external-texture.png";

    expect(
      resolveMissingTextureLabel("blob:http://localhost/abc", texture),
    ).toBe("external-texture.png");
  });

  it("ignores blob-derived source names for missing texture warnings", () => {
    const texture = new Texture();
    texture.name = "TextureNodeName.png";
    texture.userData.fbxSourceName = "abc";

    expect(
      resolveMissingTextureLabel("blob:http://localhost/abc", texture),
    ).toBe("TextureNodeName.png");
  });

  it("prefers source reference over resolved missing texture paths", () => {
    const texture = new Texture();
    texture.userData.fbxSourceName = "../tex/face.png";

    expect(
      resolveMissingTextureLabel("F:/3dcg/Blender/tilarna/face.png", texture),
    ).toBe("../tex/face.png");
  });

  it("keeps regular missing texture URLs unchanged without source names", () => {
    expect(resolveMissingTextureLabel("textures/missing.png?cache=1")).toBe(
      "textures/missing.png",
    );
  });
});

describe("loadFbxPreviewObject worker transfer policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transfers ownership at the 50 MiB worker-only threshold", async () => {
    // Avoids allocating a real production fixture while exercising the
    // established worker-only ownership boundary.
    const object = new Group();
    const buffer = new ArrayBuffer(WORKER_TRANSFER_SIZE_LIMIT);
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadFbxPreviewObject } = await import("../loader");

    await loadFbxPreviewObject(fbxFile, {});

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      fbxFile.path,
      {
        kind: "fbx",
        buffer,
        resourcePath: "C:/assets/",
      },
      {
        signal: undefined,
        timeoutMs: undefined,
        transferBuffer: true,
      },
    );
  });

  it("clones and allows main-thread fallback below the worker-only threshold", async () => {
    const buffer = readFixtureArrayBuffer(
      "tests/fixtures/models/animated-triangle.fbx",
    );
    expect(buffer.byteLength).toBeLessThan(WORKER_TRANSFER_SIZE_LIMIT);
    mocks.readBinaryFile.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadFbxPreviewObject } = await import("../loader");

    const result = await loadFbxPreviewObject(fbxFile, {});

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      fbxFile.path,
      expect.objectContaining({ kind: "fbx", buffer }),
      expect.objectContaining({ transferBuffer: false }),
    );
    expect(result.object).toBeTruthy();
    expect(result.object.type).toBe("Group");
    expect(warnSpy).toHaveBeenCalledWith(
      "[fbx] worker parse failed, falling back to main thread:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("fails closed without main-thread fallback at or above the worker-only threshold", async () => {
    mocks.readBinaryFile.mockResolvedValue(
      new ArrayBuffer(WORKER_TRANSFER_SIZE_LIMIT),
    );
    const workerError = new Error("worker failed");
    mocks.parseModelInWorker.mockRejectedValue(workerError);
    const { loadFbxPreviewObject } = await import("../loader");

    let thrown: unknown;
    try {
      await loadFbxPreviewObject(fbxFile, {});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(
      /Worker parsing failed for large file \(50\.0 MB\)\. Main thread fallback is disabled for files at or above 50 MB to prevent UI freeze\./,
    );
    expect(message).toContain("Worker error: worker failed");
    expect(message).not.toMatch(/\n\s*at\s+/);
    expect((thrown as Error).cause).toBe(workerError);
  });

  it("hydrates worker deferred texture placeholders without re-parsing FBX", async () => {
    const placeholder = new Texture();
    placeholder.userData.fbxSourceName = "Textures/albedo.png";
    placeholder.offset.set(0.1, 0.2);
    placeholder.repeat.set(2, 3);
    placeholder.center.set(0.5, 0.5);
    placeholder.rotation = 0.25;
    placeholder.flipY = false;

    const material = new MeshStandardMaterial({ map: placeholder });
    const mesh = new Mesh(new BufferGeometry(), material);
    const object = new Group();
    object.add(mesh);

    const buffer = new ArrayBuffer(WORKER_TRANSFER_SIZE_LIMIT);
    mocks.readBinaryFile.mockImplementation(async (path: string) => {
      // FBX body is large; texture reads also hit readBinaryFile.
      if (path.endsWith(".fbx") || path === fbxFile.path) {
        return buffer;
      }
      // Leave external texture reads pending so async failure cannot clear
      // the hydrated slot before assertions run.
      return new Promise<ArrayBuffer>(() => undefined);
    });
    mocks.parseModelInWorker.mockResolvedValue(object);

    const parseSpy = vi.spyOn(FBXLoader.prototype, "parse");
    const { loadFbxPreviewObject } = await import("../loader");

    const result = await loadFbxPreviewObject(fbxFile, {});

    // Worker success path must not re-parse the FBX on the main thread.
    expect(parseSpy).not.toHaveBeenCalled();
    expect(result.object).toBe(object);

    // Slot was replaced with a manager-owned deferred texture (same source).
    const hydrated = material.map;
    expect(hydrated).toBeTruthy();
    expect(hydrated).not.toBe(placeholder);
    expect(hydrated?.userData.fbxSourceName).toBe("Textures/albedo.png");
    expect(hydrated?.offset.toArray()).toEqual([0.1, 0.2]);
    expect(hydrated?.repeat.toArray()).toEqual([2, 3]);
    expect(hydrated?.center.toArray()).toEqual([0.5, 0.5]);
    expect(hydrated?.rotation).toBe(0.25);
    expect(hydrated?.flipY).toBe(false);

    parseSpy.mockRestore();
  });

  it("hydrates PSD alphaMap placeholders into non-empty RGBA8 textures", async () => {
    const placeholder = new Texture();
    placeholder.userData.fbxSourceName =
      "VRBase Anime Skintones/PSDs/BaseColor.psd";
    placeholder.offset.set(0.1, 0.2);
    placeholder.repeat.set(2, 3);
    const material = new MeshStandardMaterial({
      alphaMap: placeholder,
      transparent: true,
    });
    const mesh = new Mesh(new BufferGeometry(), material);
    const object = new Group();
    object.add(mesh);

    const buffer = new ArrayBuffer(WORKER_TRANSFER_SIZE_LIMIT);
    mocks.readBinaryFile.mockResolvedValue(buffer);
    const decodedPsdData = new Uint8Array(2048 * 2048 * 4);
    decodedPsdData.set([1, 2, 3, 4]);
    mocks.parseModelInWorker.mockResolvedValue(object);
    mocks.decodePsdFile.mockResolvedValue({
      width: 2048,
      height: 2048,
      data: decodedPsdData,
    });

    const { loadFbxPreviewObject } = await import("../loader");
    await loadFbxPreviewObject(fbxFile, {});

    await vi.waitFor(() => {
      expect(material.alphaMap).toBeTruthy();
      expect(material.alphaMap).not.toBe(placeholder);
      expect(
        (material.alphaMap as (Texture & { isDataTexture?: boolean }) | null)
          ?.isDataTexture,
      ).toBe(true);
      expect(material.alphaMap?.image.width).toBe(2048);
      expect(material.alphaMap?.image.height).toBe(2048);
      expect(material.alphaMap?.image.data.byteLength).toBe(2048 * 2048 * 4);
    });
    expect(material.alphaMap?.offset.toArray()).toEqual([0.1, 0.2]);
    expect(material.alphaMap?.repeat.toArray()).toEqual([2, 3]);
    expect(material.alphaMap?.minFilter).toBe(LinearFilter);
    expect(material.alphaMap?.magFilter).toBe(LinearFilter);
    expect(material.alphaMap?.generateMipmaps).toBe(false);
    expect(material.alphaMap?.flipY).toBe(false);
    expect(material.alphaMap?.image.data[1]).toBe(4);
    expect(mocks.decodePsdFile).toHaveBeenCalledWith(
      "C:\\assets\\VRBase Anime Skintones\\PSDs\\BaseColor.psd",
    );
  });

  it("removes a failed PSD alphaMap instead of leaving a transparent placeholder", async () => {
    const placeholder = new Texture();
    placeholder.userData.fbxSourceName =
      "VRBase Anime Skintones/PSDs/BaseColor.psd";
    const material = new MeshStandardMaterial({
      alphaMap: placeholder,
      transparent: true,
    });
    const mesh = new Mesh(new BufferGeometry(), material);
    const object = new Group();
    object.add(mesh);

    mocks.readBinaryFile.mockResolvedValue(
      new ArrayBuffer(WORKER_TRANSFER_SIZE_LIMIT),
    );
    mocks.parseModelInWorker.mockResolvedValue(object);
    mocks.decodePsdFile.mockRejectedValue(new Error("unsupported PSD"));

    const { loadFbxPreviewObject } = await import("../loader");
    await loadFbxPreviewObject(fbxFile, {});

    await vi.waitFor(() => expect(material.alphaMap).toBeNull());
    expect(material.color.getHexString()).toBe("c7d2e3");
  });
});

describe("hydrateFbxDeferredTexturePlaceholders", () => {
  it("replaces fbxSourceName placeholders via loadDeferredTexture", () => {
    const placeholder = new Texture();
    placeholder.userData.fbxSourceName = "tex/wall.tga";
    placeholder.offset.set(0.3, 0.4);
    placeholder.repeat.set(1, -1);

    const material = new MeshStandardMaterial({ map: placeholder });
    const mesh = new Mesh(new BufferGeometry(), material);

    const replacement = new Texture();
    replacement.userData.fbxSourceName = "tex/wall.tga";
    const loadDeferredTexture = vi.fn(() => replacement);

    hydrateFbxDeferredTexturePlaceholders(mesh, loadDeferredTexture);

    expect(loadDeferredTexture).toHaveBeenCalledWith("tex/wall.tga");
    expect(material.map).toBe(replacement);
    expect(replacement.offset.toArray()).toEqual([0.3, 0.4]);
    expect(replacement.repeat.toArray()).toEqual([1, -1]);
    // Texture.needsUpdate is write-only in three.js; version bump proves it ran.
    expect(replacement.version).toBeGreaterThan(0);
  });

  it("skips textures without fbxSourceName", () => {
    const map = new Texture();
    const material = new MeshStandardMaterial({ map });
    const mesh = new Mesh(new BufferGeometry(), material);
    const loadDeferredTexture = vi.fn(() => new Texture());

    hydrateFbxDeferredTexturePlaceholders(mesh, loadDeferredTexture);

    expect(loadDeferredTexture).not.toHaveBeenCalled();
    expect(material.map).toBe(map);
  });
});
