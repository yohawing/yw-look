import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Bone,
  BoxGeometry,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  Texture,
} from "three";
import type { SelectedFile } from "../../../lib/files";
import {
  createStaticSceneObject,
  toStaticScenePayload,
} from "../../../workers/staticScene";
import { formatMissingTextureWarnings } from "../../textureWarnings";
import {
  applyFbxNativeNodeMetadata,
  applyMissingTextureMaterialFallback,
  copyDecodedFbxTextureImage,
  createFbxPendingImageTexture,
  hydrateFbxDeferredTexturePlaceholders,
  registerFbxTextureMaterialFallbacks,
  resolveMissingTextureLabel,
  resolveTextureCandidates,
} from "../loader";

const mocks = vi.hoisted(() => ({
  decodePsdFile: vi.fn(),
  cancelFbxImport: vi.fn(),
  convertFbxToPreview: vi.fn(),
  parseModelInWorker: vi.fn(),
  readBinaryFile: vi.fn(),
}));

vi.mock("../../../lib/fbx", () => ({
  cancelFbxImport: mocks.cancelFbxImport,
  convertFbxToPreview: mocks.convertFbxToPreview,
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  decodePsdFile: mocks.decodePsdFile,
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("../../modelParseWorker", () => ({
  DEFAULT_MODEL_PARSE_TIMEOUT_MS: 30_000,
  isAbortOrTimeoutError: (error: unknown) =>
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError"),
  parseModelInWorker: mocks.parseModelInWorker,
}));

const fbxFile: SelectedFile = {
  extension: "fbx",
  fileName: "asset.fbx",
  kind: "model",
  parentDirectory: "C:\\assets",
  path: "C:\\assets\\asset.fbx",
};

describe("FBX missing texture fallback", () => {
  it("hydrates the matching external material after Worker roundtrip even when the image failed to decode", () => {
    const root = new Group();
    const material = new MeshStandardMaterial();
    material.userData = { fbxMaterialId: 41, fbxMaterialIndex: 0 };
    root.userData.fbxTextureBindings = [
      {
        materialId: 41,
        materialIndex: 0,
        slot: "baseColor",
        source: "textures/albedo.png",
      },
    ];
    root.add(new Mesh(new BoxGeometry(), material));
    const restored = createStaticSceneObject(
      toStaticScenePayload(root, false)!,
    );
    const texture = new Texture();
    const load = vi.fn(() => texture);
    hydrateFbxDeferredTexturePlaceholders(restored, load);
    expect(load).toHaveBeenCalledExactlyOnceWith("textures/albedo.png");
    expect(
      ((restored.children[0] as Mesh).material as MeshStandardMaterial).map,
    ).toBe(texture);
    expect(material.map).toBeNull();
  });

  it("keeps explicitly embedded textures without requesting sidecars on the main-thread path", () => {
    const texture = new Texture();
    texture.image = { width: 16, height: 16 };
    texture.userData = {
      fbxSourceName: "absent/albedo.png",
      fbxDeferred: false,
      textureSourceKind: "embedded",
    };
    const material = new MeshStandardMaterial({ map: texture });
    material.userData.fbxBaseColorSource = "absent/albedo.png";
    const load = vi.fn(() => new Texture());
    hydrateFbxDeferredTexturePlaceholders(
      new Mesh(new BoxGeometry(), material),
      load,
    );
    expect(load).not.toHaveBeenCalled();
    expect(material.map).toBe(texture);
  });
  it("applies native node visibility metadata", () => {
    const root = new Group();
    const hidden = new Group();
    hidden.userData.visible = false;
    const motionBone = new Group();
    motionBone.userData.fbxBone = true;
    root.add(hidden, motionBone);
    applyFbxNativeNodeMetadata(root);
    expect(hidden.visible).toBe(false);
    expect(motionBone).toBeInstanceOf(Bone);
    expect((motionBone as Group & { isBone?: boolean }).isBone).toBe(true);
    expect(motionBone.type).toBe("Bone");
  });

  it("uses authored, basename, Textures, then parent Texture candidates", () => {
    expect(
      resolveTextureCandidates("../Texture/Parts01.png", "F:\\pkg\\fbx"),
    ).toEqual([
      "F:\\pkg\\Texture\\Parts01.png",
      "F:\\pkg\\fbx\\Parts01.png",
      "F:\\pkg\\fbx\\Textures\\Parts01.png",
    ]);
  });

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
    target.image = { width: 1, height: 1 };
    const dispose = vi.spyOn(target, "dispose");
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

    expect(dispose).toHaveBeenCalledTimes(1);
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

describe("loadFbxPreviewObject native GLB policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelFbxImport.mockResolvedValue(true);
    mocks.convertFbxToPreview.mockResolvedValue(new ArrayBuffer(64));
  });

  it("invokes native conversion once and transfers the GLB", async () => {
    const object = new Group();
    object.userData.fbxWarnings = ["unsupported constraint"];
    const buffer = new ArrayBuffer(64);
    mocks.convertFbxToPreview.mockResolvedValue(buffer);
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadFbxPreviewObject } = await import("../loader");

    const onWarning = vi.fn();
    await loadFbxPreviewObject(fbxFile, { onWarning });

    expect(mocks.convertFbxToPreview).toHaveBeenCalledTimes(1);
    expect(mocks.convertFbxToPreview).toHaveBeenCalledWith(
      fbxFile.path,
      expect.stringMatching(/^fbx-/),
    );
    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      fbxFile.path,
      {
        kind: "fbxGlb",
        buffer,
      },
      {
        signal: undefined,
        timeoutMs: undefined,
        transferBuffer: true,
      },
    );
    expect(onWarning).toHaveBeenCalledWith("unsupported constraint");
  });

  it("cancels the native request when AbortSignal fires", async () => {
    const controller = new AbortController();
    mocks.convertFbxToPreview.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const { loadFbxPreviewObject } = await import("../loader");
    await expect(
      loadFbxPreviewObject(fbxFile, { signal: controller.signal }),
    ).rejects.toBeTruthy();
    expect(mocks.cancelFbxImport).toHaveBeenCalledWith(
      expect.stringMatching(/^fbx-/),
    );
  });

  it("cancels a pending native conversion on timeout", async () => {
    vi.useFakeTimers();
    mocks.convertFbxToPreview.mockImplementation(
      () => new Promise<ArrayBuffer>(() => undefined),
    );
    const { loadFbxPreviewObject } = await import("../loader");
    const pending = loadFbxPreviewObject(fbxFile, { parseTimeoutMs: 250 });
    const rejection = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(250);
    await rejection;
    expect(mocks.cancelFbxImport).toHaveBeenCalledWith(
      expect.stringMatching(/^fbx-/),
    );
    vi.useRealTimers();
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

    mocks.readBinaryFile.mockImplementation(async () => {
      // Leave external texture reads pending so async failure cannot clear
      // the hydrated slot before assertions run.
      return new Promise<ArrayBuffer>(() => undefined);
    });
    mocks.parseModelInWorker.mockResolvedValue(object);

    const { loadFbxPreviewObject } = await import("../loader");

    const result = await loadFbxPreviewObject(fbxFile, {});

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

    mocks.readBinaryFile.mockResolvedValue(new ArrayBuffer(64));
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
      const alphaMap = material.alphaMap as DataTexture | null;
      expect(material.alphaMap).toBeTruthy();
      expect(material.alphaMap).not.toBe(placeholder);
      expect(
        (material.alphaMap as (Texture & { isDataTexture?: boolean }) | null)
          ?.isDataTexture,
      ).toBe(true);
      expect(alphaMap?.image.width).toBe(2048);
      expect(alphaMap?.image.height).toBe(2048);
      expect(alphaMap?.image.data?.byteLength).toBe(2048 * 2048 * 4);
    });
    expect(material.alphaMap?.offset.toArray()).toEqual([0.1, 0.2]);
    expect(material.alphaMap?.repeat.toArray()).toEqual([2, 3]);
    expect(material.alphaMap?.minFilter).toBe(LinearFilter);
    expect(material.alphaMap?.magFilter).toBe(LinearFilter);
    expect(material.alphaMap?.generateMipmaps).toBe(false);
    expect(material.alphaMap?.flipY).toBe(false);
    expect((material.alphaMap as DataTexture | null)?.image.data?.[1]).toBe(4);
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

    mocks.readBinaryFile.mockResolvedValue(new ArrayBuffer(64));
    mocks.parseModelInWorker.mockResolvedValue(object);
    mocks.decodePsdFile.mockRejectedValue(new Error("unsupported PSD"));

    const { loadFbxPreviewObject } = await import("../loader");
    await loadFbxPreviewObject(fbxFile, {});

    await vi.waitFor(() => expect(material.alphaMap).toBeNull());
    expect(material.color.getHexString()).toBe("c7d2e3");
  });
});

describe("hydrateFbxDeferredTexturePlaceholders", () => {
  it("hydrates from native material extras when image extras were lost", () => {
    const material = new MeshStandardMaterial();
    material.userData.fbxBaseColorSource = "Parts02.png";
    const mesh = new Mesh(new BufferGeometry(), material);
    const replacement = new Texture();
    const loadDeferredTexture = vi.fn(() => replacement);

    hydrateFbxDeferredTexturePlaceholders(mesh, loadDeferredTexture);

    expect(loadDeferredTexture).toHaveBeenCalledWith("Parts02.png");
    expect(material.map).toBe(replacement);
  });

  it("hydrates from native root texture bindings", () => {
    const material = new MeshStandardMaterial();
    material.userData.fbxMaterialId = 17;
    const root = new Group();
    root.userData.fbxTextureBindings = [
      { materialId: 17, slot: "baseColor", source: "Parts02.png" },
    ];
    root.add(new Mesh(new BufferGeometry(), material));
    const replacement = new Texture();
    const loadDeferredTexture = vi.fn(() => replacement);

    hydrateFbxDeferredTexturePlaceholders(root, loadDeferredTexture);

    expect(loadDeferredTexture).toHaveBeenCalledWith("Parts02.png");
    expect(material.map).toBe(replacement);
  });

  it("routes duplicate material names by native numeric identity", () => {
    const first = new MeshStandardMaterial();
    const second = new MeshStandardMaterial();
    first.name = second.name = "";
    first.userData.fbxMaterialId = 11;
    second.userData.fbxMaterialId = 12;
    const root = new Group();
    root.userData.fbxTextureBindings = [
      { materialId: 11, slot: "baseColor", source: "first.png" },
      { materialId: 12, slot: "baseColor", source: "second.png" },
    ];
    root.add(new Mesh(new BufferGeometry(), first));
    root.add(new Mesh(new BufferGeometry(), second));
    const firstTexture = new Texture();
    const secondTexture = new Texture();
    const loadDeferredTexture = vi.fn((source: string) =>
      source === "first.png" ? firstTexture : secondTexture,
    );

    hydrateFbxDeferredTexturePlaceholders(root, loadDeferredTexture);

    expect(first.map).toBe(firstTexture);
    expect(second.map).toBe(secondTexture);
    expect(loadDeferredTexture).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to material index when a native ID disagrees", () => {
    const material = new MeshStandardMaterial();
    material.userData.fbxMaterialId = 41;
    material.userData.fbxMaterialIndex = 3;
    const root = new Group();
    root.userData.fbxTextureBindings = [
      {
        materialId: 99,
        materialIndex: 3,
        slot: "baseColor",
        source: "wrong.png",
      },
    ];
    root.add(new Mesh(new BufferGeometry(), material));
    const loadDeferredTexture = vi.fn(() => new Texture());

    hydrateFbxDeferredTexturePlaceholders(root, loadDeferredTexture);

    expect(loadDeferredTexture).not.toHaveBeenCalled();
    expect(material.map).toBeNull();
  });

  it("hydrates opacity bindings as alphaMap with sampler transform and blend mode", () => {
    const material = new MeshStandardMaterial();
    material.userData.fbxMaterialId = 23;
    material.userData.fbxOpacitySource = "opacity.png";
    material.userData.fbxOpacityMode = "BLEND";
    const root = new Group();
    root.userData.fbxTextureBindings = [
      {
        materialId: 23,
        slot: "opacity",
        source: "opacity.png",
        wrapS: 33071,
        wrapT: 10497,
        transform: { offset: [0.1, 0.2], scale: [2, 3], rotation: 0.25 },
      },
    ];
    root.add(new Mesh(new BufferGeometry(), material));
    const replacement = new Texture();

    hydrateFbxDeferredTexturePlaceholders(
      root,
      vi.fn(() => replacement),
    );

    expect(material.alphaMap).toBe(replacement);
    expect(material.transparent).toBe(true);
    expect(material.alphaMap?.wrapS).toBe(ClampToEdgeWrapping);
    expect(material.alphaMap?.wrapT).toBe(RepeatWrapping);
    expect(material.alphaMap?.offset.toArray()).toEqual([0.1, 0.2]);
    expect(material.alphaMap?.repeat.toArray()).toEqual([2, 3]);
    expect(material.alphaMap?.rotation).toBe(0.25);
  });

  it("keeps opacity and ambient-occlusion bindings separate", () => {
    const embeddedOpacity = new Texture();
    embeddedOpacity.image = { width: 1, height: 1 };
    const ambientOcclusion = new Texture();
    const material = new MeshStandardMaterial({ aoMap: embeddedOpacity });
    material.userData.fbxMaterialId = 31;
    material.userData.fbxOpacityTextureIndex = 4;
    material.userData.fbxOpacityEmbedded = true;
    material.userData.fbxOpacitySource = "embedded-opacity.png";
    material.userData.fbxAmbientOcclusionSource = "ao.png";
    const root = new Group();
    root.userData.fbxTextureBindings = [
      {
        materialId: 31,
        slot: "opacity",
        source: "embedded-opacity.png",
      },
      { materialId: 31, slot: "ambientOcclusion", source: "ao.png" },
    ];
    root.add(new Mesh(new BufferGeometry(), material));
    const loadDeferredTexture = vi.fn(() => ambientOcclusion);

    hydrateFbxDeferredTexturePlaceholders(root, loadDeferredTexture);

    expect(material.alphaMap).toBe(embeddedOpacity);
    expect(material.aoMap).toBe(ambientOcclusion);
    expect(loadDeferredTexture).toHaveBeenCalledWith("ao.png");
    expect(loadDeferredTexture).not.toHaveBeenCalledWith(
      "embedded-opacity.png",
    );
  });

  it("keeps unauthored opacity materials opaque", () => {
    const material = new MeshStandardMaterial();
    const mesh = new Mesh(new BufferGeometry(), material);

    hydrateFbxDeferredTexturePlaceholders(mesh, vi.fn());

    expect(material.alphaMap).toBeNull();
    expect(material.transparent).toBe(false);
  });

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
