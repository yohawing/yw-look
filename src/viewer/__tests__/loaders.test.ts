/**
 * Unit tests for pure helper functions in src/viewer/loaders.ts.
 *
 * The full `loadPreviewObject` function is NOT tested here because it
 * requires Three.js WebGL context, Tauri IPC, and real binary assets —
 * none of which are available in jsdom. Instead we test the pure
 * utilities that are exported with the @internal tag.
 */

import { describe, it, expect, vi } from "vitest";
import { BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
import {
  getMimeType,
  listOptionalLoaderPacks,
  listRegisteredLoaders,
  resolveSiblingPath,
  isUsdcCrateBuffer,
  isDeferredUsdEmptyStageError,
  inspectionHasDeferredPayloads,
  deferredSummaryHasNoRenderableGeometry,
  readUsdzFirstFileName,
  shouldFailClosedOnUsdPreviewDecisionFailure,
  summarizeOptionalLoaderPacks,
  applyMissingGltfTextureFallbacks,
  applyMissingTextureMaterialFallback,
  formatMissingTextureWarnings,
  resolveMissingTextureLabel,
  getPreviewSupportState,
  incompatibleOptionalLoaderPackIds,
  registerFbxTextureMaterialFallbacks,
  resolveColladaTextureUrl,
  buildColladaWorkerTexturePayload,
  mapWithConcurrency,
  type GltfDocument,
} from "../loaders";
import {
  formatDisabledOptionalLoaderMessage,
  formatIncompatibleOptionalLoaderMessage,
  formatMissingOptionalLoaderMessage,
  formatUnsupportedFormatMessage,
} from "../types";

// ---------------------------------------------------------------------------
// getMimeType
// ---------------------------------------------------------------------------

describe("getMimeType", () => {
  it("returns image/png for png", () => {
    expect(getMimeType("png")).toBe("image/png");
  });

  it("returns image/jpeg for jpg", () => {
    expect(getMimeType("jpg")).toBe("image/jpeg");
  });

  it("returns image/jpeg for jpeg", () => {
    expect(getMimeType("jpeg")).toBe("image/jpeg");
  });

  it("returns image/x-tga for tga", () => {
    expect(getMimeType("tga")).toBe("image/x-tga");
  });

  it("returns image/vnd-ms.dds for dds", () => {
    expect(getMimeType("dds")).toBe("image/vnd-ms.dds");
  });

  it("returns image/vnd.radiance for hdr", () => {
    expect(getMimeType("hdr")).toBe("image/vnd.radiance");
  });

  it("returns image/x-exr for exr", () => {
    expect(getMimeType("exr")).toBe("image/x-exr");
  });

  it("returns application/octet-stream for bin", () => {
    expect(getMimeType("bin")).toBe("application/octet-stream");
  });

  it("returns application/octet-stream for unknown extension", () => {
    expect(getMimeType("xyz")).toBe("application/octet-stream");
  });

  it("returns application/octet-stream for empty string", () => {
    expect(getMimeType("")).toBe("application/octet-stream");
  });

  it("returns image/ktx2 for ktx2", () => {
    expect(getMimeType("ktx2")).toBe("image/ktx2");
  });

  it("returns image/bmp for bmp", () => {
    expect(getMimeType("bmp")).toBe("image/bmp");
  });
});

// ---------------------------------------------------------------------------
// preview support classification
// ---------------------------------------------------------------------------

describe("preview support classification", () => {
  it("registers existing core preview formats through the loader registry", () => {
    const extensions = new Set(
      listRegisteredLoaders().map((loader) => loader.extension),
    );

    expect(extensions.has("glb")).toBe(true);
    expect(extensions.has("gltf")).toBe(true);
    expect(extensions.has("vrm")).toBe(true);
    expect(extensions.has("obj")).toBe(true);
    expect(extensions.has("usdz")).toBe(true);
    expect(extensions.has("abc")).toBe(true);
    expect(extensions.has("ktx2")).toBe(true);
  });

  it("classifies implemented core loaders separately from optional packs", () => {
    expect(getPreviewSupportState("glb")).toBe("implemented");
    expect(getPreviewSupportState("vrm")).toBe("implemented");
    expect(getPreviewSupportState("abc")).toBe("implemented");
    expect(getPreviewSupportState("vrma")).toBe("missingOptionalLoader");
  });

  it("marks MMD model and motion formats as implemented", () => {
    expect(getPreviewSupportState("pmx")).toBe("implemented");
    expect(getPreviewSupportState("pmd")).toBe("implemented");
    expect(getPreviewSupportState("vmd")).toBe("implemented");
  });

  it("marks optional MMD formats as missing when the pack is absent", () => {
    expect(
      getPreviewSupportState("pmx", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
    expect(
      getPreviewSupportState("pmd", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
    expect(
      getPreviewSupportState("vmd", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
  });

  it("marks optional formats as disabled when their pack is disabled", () => {
    expect(
      getPreviewSupportState("pmx", {
        disabledOptionalLoaderPackIds: ["mmd-loader-pack"],
      }),
    ).toBe("disabledOptionalLoader");
    expect(
      getPreviewSupportState("glb", {
        disabledOptionalLoaderPackIds: ["core-preview-loader"],
      }),
    ).toBe("implemented");
  });

  it("marks optional formats as incompatible when their pack manifest is incompatible", () => {
    expect(
      getPreviewSupportState("pmx", {
        incompatibleOptionalLoaderPackIds: ["mmd-loader-pack"],
      }),
    ).toBe("incompatibleOptionalLoader");
  });

  it("prioritizes missing optional packs over stale disabled settings", () => {
    expect(
      getPreviewSupportState("pmx", {
        disabledOptionalLoaderPackIds: ["mmd-loader-pack"],
        optionalLoaderInstalled: false,
      }),
    ).toBe("missingOptionalLoader");
  });

  it("marks the bundled VRM loader pack as optional but installed", () => {
    expect(
      listRegisteredLoaders().find((loader) => loader.extension === "vrm"),
    ).toMatchObject({
      id: "vrm-loader-pack",
      name: "VRM Loader Pack",
      optional: true,
      installed: true,
    });
  });

  it("registers the bundled MMD loader pack for static model preview", () => {
    expect(
      listRegisteredLoaders().find((loader) => loader.extension === "pmx"),
    ).toMatchObject({
      id: "mmd-loader-pack",
      name: "MMD Loader Pack",
      optional: true,
      installed: true,
    });
    expect(
      listRegisteredLoaders().find((loader) => loader.extension === "pmd"),
    ).toMatchObject({
      id: "mmd-loader-pack",
      name: "MMD Loader Pack",
      optional: true,
      installed: true,
    });
  });

  it("registers the bundled Gaussian splat loader pack formats", () => {
    const splatLoaders = listRegisteredLoaders().filter(
      (loader) => loader.id === "gaussian-splat-loader-pack",
    );

    expect(splatLoaders.map((loader) => loader.extension).sort()).toEqual([
      "ksplat",
      "sog",
      "splat",
      "spz",
    ]);
    expect(getPreviewSupportState("sog")).toBe("implemented");
    expect(
      getPreviewSupportState("sog", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
  });

  it("summarizes optional loader packs for Settings reporting", () => {
    expect(listOptionalLoaderPacks()).toEqual([
      {
        id: "gaussian-splat-loader-pack",
        name: "Gaussian Splat Loader Pack",
        extensions: ["ksplat", "sog", "splat", "spz"],
        installed: true,
        enabled: true,
        manifestInstalled: false,
        runtimeAvailable: true,
        version: undefined,
        compatibility: {
          state: "bundled",
          label: "Bundled runtime",
          detail:
            "The loader is bundled with this build but has no managed manifest.",
        },
      },
      {
        id: "mmd-loader-pack",
        name: "MMD Loader Pack",
        extensions: ["pmd", "pmx", "vmd"],
        installed: true,
        enabled: true,
        manifestInstalled: false,
        runtimeAvailable: true,
        version: undefined,
        compatibility: {
          state: "bundled",
          label: "Bundled runtime",
          detail:
            "The loader is bundled with this build but has no managed manifest.",
        },
      },
      {
        id: "vrm-loader-pack",
        name: "VRM Loader Pack",
        extensions: ["vrm"],
        installed: true,
        enabled: true,
        manifestInstalled: false,
        runtimeAvailable: true,
        version: undefined,
        compatibility: {
          state: "bundled",
          label: "Bundled runtime",
          detail:
            "The loader is bundled with this build but has no managed manifest.",
        },
      },
    ]);
  });

  it("applies optional loader pack settings to Settings reporting", () => {
    expect(
      listOptionalLoaderPacks({
        "mmd-loader-pack": { enabled: false },
      }).find((pack) => pack.id === "mmd-loader-pack"),
    ).toMatchObject({
      id: "mmd-loader-pack",
      enabled: false,
      installed: true,
      manifestInstalled: false,
      runtimeAvailable: true,
    });
  });

  it("merges optional loader manifests into Settings reporting without changing runtime extensions", () => {
    expect(
      listOptionalLoaderPacks({}, [
        {
          id: "mmd-loader-pack",
          name: "MMD Loader Pack",
          version: "0.2.0",
          minimumAppVersion: "0.1.0",
          maximumAppVersion: null,
          compatibility: {
            state: "compatible",
            message: null,
          },
          extensions: ["pmx", "pmd"],
          entry: "loader.js",
          packPath: "optional-loaders/mmd",
          entryPath: "optional-loaders/mmd/loader.js",
        },
      ]).find((pack) => pack.id === "mmd-loader-pack"),
    ).toMatchObject({
      id: "mmd-loader-pack",
      extensions: ["pmd", "pmx", "vmd"],
      installed: true,
      enabled: true,
      manifestInstalled: true,
      runtimeAvailable: true,
      version: "0.2.0",
      compatibility: {
        state: "compatible",
        label: "Compatible",
        detail: undefined,
      },
    });
  });

  it("does not treat manifest-only packs or extensions as runtime installed", () => {
    expect(
      summarizeOptionalLoaderPacks(
        [
          {
            id: "vrm-loader-pack",
            name: "VRM Loader Pack",
            extension: "vrm",
            optional: true,
            installed: true,
          },
        ],
        {},
        [
          {
            id: "vrm-loader-pack",
            name: "VRM Loader Pack",
            version: "0.2.0",
            minimumAppVersion: "0.1.0",
            maximumAppVersion: null,
            compatibility: {
              state: "compatible",
              message: null,
            },
            extensions: ["vrm", "vrma"],
            entry: "loader.js",
            packPath: "optional-loaders/vrm",
            entryPath: "optional-loaders/vrm/loader.js",
          },
        ],
      ),
    ).toEqual([
      {
        id: "vrm-loader-pack",
        name: "VRM Loader Pack",
        extensions: ["vrm"],
        installed: true,
        enabled: true,
        manifestInstalled: true,
        runtimeAvailable: true,
        version: "0.2.0",
        compatibility: {
          state: "compatible",
          label: "Compatible",
          detail: undefined,
        },
      },
    ]);
  });

  it("reports optional pack compatibility issues for Settings", () => {
    const manifests = [
      {
        id: "mmd-loader-pack",
        name: "MMD Loader Pack",
        version: "9.0.0",
        minimumAppVersion: "9.0.0",
        maximumAppVersion: null,
        compatibility: {
          state: "requiresNewerApp",
          message: "Requires yw-look 9.0.0 or newer. Current version is 0.2.2.",
        },
        extensions: ["pmx"],
        entry: "loader.js",
        packPath: "optional-loaders/mmd",
        entryPath: "optional-loaders/mmd/loader.js",
      },
    ];

    expect(
      summarizeOptionalLoaderPacks(
        [
          {
            id: "mmd-loader-pack",
            name: "MMD Loader Pack",
            extension: "pmx",
            optional: true,
            installed: true,
          },
        ],
        {},
        manifests,
      )[0].compatibility,
    ).toEqual({
      state: "requiresNewerApp",
      label: "App update required",
      detail: "Requires yw-look 9.0.0 or newer. Current version is 0.2.2.",
    });
    expect(
      summarizeOptionalLoaderPacks(
        [
          {
            id: "mmd-loader-pack",
            name: "MMD Loader Pack",
            extension: "pmx",
            optional: true,
            installed: true,
          },
        ],
        {},
        manifests,
      )[0].enabled,
    ).toBe(false);
    expect(incompatibleOptionalLoaderPackIds(manifests)).toEqual([
      "mmd-loader-pack",
    ]);
  });

  it("marks a pack missing when any registered pack extension is missing", () => {
    expect(
      summarizeOptionalLoaderPacks([
        {
          id: "mixed-loader-pack",
          name: "Mixed Loader Pack",
          extension: "one",
          optional: true,
          installed: true,
        },
        {
          id: "mixed-loader-pack",
          name: "Mixed Loader Pack",
          extension: "two",
          optional: true,
          installed: false,
        },
      ]),
    ).toEqual([
      {
        id: "mixed-loader-pack",
        name: "Mixed Loader Pack",
        extensions: ["one", "two"],
        installed: false,
        manifestInstalled: false,
        runtimeAvailable: false,
        enabled: true,
        version: undefined,
        compatibility: {
          state: "runtimeMissing",
          label: "Runtime missing",
          detail:
            "This build does not include the loader runtime for this pack.",
        },
      },
    ]);
  });

  it("keeps unknown extensions in the generic unsupported bucket", () => {
    expect(getPreviewSupportState("assetbundle")).toBe("unsupported");
  });

  it("formats missing optional loader copy without exposing technical details", () => {
    expect(formatMissingOptionalLoaderMessage("vrm")).toEqual({
      title: "VRM Loader Pack is not installed.",
      body: "Install VRM Loader Pack to preview VRM files.",
    });
    expect(formatMissingOptionalLoaderMessage("pmx")).toEqual({
      title: "MMD Loader Pack is not installed.",
      body: "Install MMD Loader Pack to preview PMX files.",
    });
  });

  it("formats disabled optional loader copy without install guidance", () => {
    expect(formatDisabledOptionalLoaderMessage("vrm")).toEqual({
      title: "VRM Loader Pack is disabled.",
      body: "Enable VRM Loader Pack in Settings to preview VRM files.",
    });
  });

  it("formats incompatible optional loader copy without settings guidance", () => {
    expect(formatIncompatibleOptionalLoaderMessage("vrm")).toEqual({
      title: "VRM Loader Pack is not compatible with this app version.",
      body: "Update yw-look or reinstall VRM Loader Pack to preview VRM files.",
    });
  });

  it("formats unsupported extension copy with the attempted extension", () => {
    expect(formatUnsupportedFormatMessage("assetbundle").body).toContain(
      ".assetbundle",
    );
  });

  it("formats unsupported extension copy from registered loader extensions", () => {
    const registeredExtensions = listRegisteredLoaders().map(
      (loader) => loader.extension,
    );
    const message = formatUnsupportedFormatMessage(
      "assetbundle",
      registeredExtensions,
    );

    expect(message.body).toContain("Supported formats include");
    for (const extension of registeredExtensions) {
      expect(message.body).toContain(extension.toUpperCase());
    }
  });
});

// ---------------------------------------------------------------------------
// USD deferred payload handling
// ---------------------------------------------------------------------------

describe("USD deferred payload handling", () => {
  it("recognizes the empty-stage error produced by deferred payload extraction", () => {
    expect(
      isDeferredUsdEmptyStageError(
        'Parse("no renderable Mesh prims found in stage")',
      ),
    ).toBe(true);
    expect(
      isDeferredUsdEmptyStageError(
        new Error("no renderable Mesh prims found in stage"),
      ),
    ).toBe(true);
  });

  it("does not classify unrelated USD errors as an empty deferred stage", () => {
    expect(isDeferredUsdEmptyStageError("UsdStage::Open returned null")).toBe(
      false,
    );
  });

  it("requires an unloaded payload before treating an empty stage as deferred", () => {
    expect(
      inspectionHasDeferredPayloads({
        payloads: [{ state: "unloaded" }],
      } as Parameters<typeof inspectionHasDeferredPayloads>[0]),
    ).toBe(true);
    expect(
      inspectionHasDeferredPayloads({
        payloads: [{ state: "loaded" }, { state: "missing" }],
      } as Parameters<typeof inspectionHasDeferredPayloads>[0]),
    ).toBe(false);
  });

  it("only skips deferred extraction when no renderable vertices remain", () => {
    expect(
      deferredSummaryHasNoRenderableGeometry({
        unloadedPayloadCount: 1,
        totalVertices: 0,
      }),
    ).toBe(true);
    expect(
      deferredSummaryHasNoRenderableGeometry({
        unloadedPayloadCount: 1,
        totalVertices: 12,
      }),
    ).toBe(false);
    expect(
      deferredSummaryHasNoRenderableGeometry({
        unloadedPayloadCount: 0,
        totalVertices: 0,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveSiblingPath
// ---------------------------------------------------------------------------

describe("resolveSiblingPath", () => {
  it("resolves a simple filename on Unix path", () => {
    expect(resolveSiblingPath("/home/user/models", "texture.png")).toBe(
      "/home/user/models/texture.png",
    );
  });

  it("resolves a simple filename on Windows path", () => {
    // Windows drive letter detected → backslash separator
    expect(resolveSiblingPath("C:\\Users\\user\\models", "texture.png")).toBe(
      "C:\\Users\\user\\models\\texture.png",
    );
  });

  it("resolves relative ../ on Unix path", () => {
    expect(resolveSiblingPath("/home/user/models/sub", "../texture.png")).toBe(
      "/home/user/models/texture.png",
    );
  });

  it("resolves relative ../ on Windows path", () => {
    expect(
      resolveSiblingPath("C:\\Users\\user\\models\\sub", "../texture.png"),
    ).toBe("C:\\Users\\user\\models\\texture.png");
  });

  it("ignores leading ./ in relative path", () => {
    expect(resolveSiblingPath("/home/user/models", "./texture.png")).toBe(
      "/home/user/models/texture.png",
    );
  });

  it("resolves nested sub-directory path", () => {
    expect(resolveSiblingPath("/home/user/models", "textures/color.png")).toBe(
      "/home/user/models/textures/color.png",
    );
  });

  it("handles mixed slashes in base on Windows", () => {
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

// ---------------------------------------------------------------------------
// missing texture fallback
// ---------------------------------------------------------------------------

describe("missing texture fallback", () => {
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

  it("removes missing normal and emissive texture slots from glTF fallback materials", () => {
    const json: GltfDocument = {
      images: [{ uri: "missing-normal.png" }],
      textures: [{ source: 0 }],
      materials: [
        {
          normalTexture: { index: 0 },
          emissiveTexture: { index: 0 },
        },
      ],
    };

    applyMissingGltfTextureFallbacks(json, new Set([0]));
    const material = json.materials![0];

    expect(material.pbrMetallicRoughness).toEqual({
      baseColorFactor: [0.78, 0.82, 0.9, 1],
      metallicFactor: 0,
      roughnessFactor: 0.72,
    });
    expect(material.normalTexture).toBeUndefined();
    expect(material.emissiveTexture).toBeUndefined();
  });

  it("falls back when missing textures are referenced through glTF material extensions", () => {
    const json: GltfDocument = {
      images: [{ uri: "missing-clearcoat.png" }],
      textures: [{ source: 0 }],
      materials: [
        {
          extensions: {
            KHR_materials_clearcoat: {
              clearcoatTexture: { index: 0 },
            },
          },
        },
      ],
    };

    applyMissingGltfTextureFallbacks(json, new Set([0]));
    const material = json.materials![0];

    expect(material.pbrMetallicRoughness).toEqual({
      baseColorFactor: [0.78, 0.82, 0.9, 1],
      metallicFactor: 0,
      roughnessFactor: 0.72,
    });
    expect(material.extensions).toBeUndefined();
  });

  it("does not treat non-texture extension indexes as missing texture references", () => {
    const json: GltfDocument = {
      images: [{ uri: "missing-clearcoat.png" }],
      textures: [{ source: 0 }],
      materials: [
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
    const material = json.materials![0];

    expect(material.pbrMetallicRoughness).toBeUndefined();
    expect(material.extensions).toEqual({
      EXT_example: {
        variantIndex: { index: 0 },
      },
    });
  });

  it("only maps known missing Collada texture URLs to the fallback texture", () => {
    const blobCache = new Map([["textures/present.png", "blob:present"]]);
    const missingPaths = new Set(["textures/missing.png"]);

    expect(
      resolveColladaTextureUrl("textures/present.png", blobCache, missingPaths),
    ).toBe("blob:present");
    expect(
      resolveColladaTextureUrl("textures/missing.png", blobCache, missingPaths),
    ).toContain("data:image/png;base64,");
    expect(
      resolveColladaTextureUrl(
        "textures/untracked.png",
        blobCache,
        missingPaths,
      ),
    ).toBe("textures/untracked.png");
  });

  it("builds a serializable Collada worker texture payload from resolved references", () => {
    const blobCache = new Map([
      ["textures/present.png", "blob:present"],
      ["textures/second.png", "blob:second"],
    ]);
    const missingPaths = ["textures/missing.png"];
    const { textureUrls, missingTextureUrls } =
      buildColladaWorkerTexturePayload(blobCache, missingPaths);
    const missingPathSet = new Set(missingPaths);

    expect(textureUrls).toEqual({
      "textures/present.png": "blob:present",
      "textures/second.png": "blob:second",
    });
    expect(missingTextureUrls).toEqual(["textures/missing.png"]);
    expect(
      resolveColladaTextureUrl(
        "textures/present.png",
        blobCache,
        missingPathSet,
      ),
    ).toBe(textureUrls["textures/present.png"]);
    expect(
      resolveColladaTextureUrl(
        "textures/missing.png",
        blobCache,
        missingPathSet,
      ),
    ).toContain("data:image/png;base64,");
  });

  it("removes failed FBX texture slots from registered materials", () => {
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

  it("prefers FBX source name over blob URL for missing texture warnings", () => {
    const texture = new Texture();
    texture.name = "source-name-from-texture-name.png";
    texture.userData.fbxSourceName = "Embedded/Texture_01.png";

    expect(
      resolveMissingTextureLabel("blob:http://localhost/abc", texture),
    ).toBe("Texture_01.png");
    expect(
      formatMissingTextureWarnings([
        resolveMissingTextureLabel("blob:http://localhost/abc", texture),
      ])[0],
    ).toContain("Texture_01.png");
  });

  it("falls back to texture name for blob missing texture warnings", () => {
    const texture = new Texture();
    texture.name = "external-texture.png";

    expect(
      resolveMissingTextureLabel("blob:http://localhost/abc", texture),
    ).toBe("external-texture.png");
  });

  it("ignores blob-derived FBX source names for missing texture warnings", () => {
    const texture = new Texture();
    texture.name = "TextureNodeName.png";
    texture.userData.fbxSourceName = "abc";

    expect(
      resolveMissingTextureLabel("blob:http://localhost/abc", texture),
    ).toBe("TextureNodeName.png");
  });

  it("prefers FBX source reference over resolved missing texture paths", () => {
    const texture = new Texture();
    texture.userData.fbxSourceName = "../tex/face.png";

    expect(
      resolveMissingTextureLabel("F:/3dcg/Blender/tilarna/face.png", texture),
    ).toBe("../tex/face.png");
  });

  it("keeps regular missing texture URLs unchanged without FBX source names", () => {
    expect(resolveMissingTextureLabel("textures/missing.png?cache=1")).toBe(
      "textures/missing.png",
    );
  });
});

// ---------------------------------------------------------------------------
// isUsdcCrateBuffer
// ---------------------------------------------------------------------------

describe("isUsdcCrateBuffer", () => {
  /** PXR-USDC magic bytes */
  const USDC_MAGIC = new Uint8Array([
    0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43,
  ]);

  it("returns true for a valid USDC header", () => {
    const buffer = new ArrayBuffer(16);
    new Uint8Array(buffer).set(USDC_MAGIC);
    expect(isUsdcCrateBuffer(buffer)).toBe(true);
  });

  it("returns false for a USDA text buffer", () => {
    const text = "#usda 1.0\ndef Xform { }";
    const buffer = new TextEncoder().encode(text).buffer;
    expect(isUsdcCrateBuffer(buffer)).toBe(false);
  });

  it("returns false for a buffer shorter than the magic header", () => {
    const buffer = new ArrayBuffer(4);
    new Uint8Array(buffer).set(USDC_MAGIC.slice(0, 4));
    expect(isUsdcCrateBuffer(buffer)).toBe(false);
  });

  it("returns false for an empty buffer", () => {
    expect(isUsdcCrateBuffer(new ArrayBuffer(0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldFailClosedOnUsdPreviewDecisionFailure
// ---------------------------------------------------------------------------

describe("shouldFailClosedOnUsdPreviewDecisionFailure", () => {
  it.each(["usd", "usda", "usdc", "usdz"])(
    "fails closed for %s in the Tauri runtime",
    (extension) => {
      expect(shouldFailClosedOnUsdPreviewDecisionFailure(extension, true)).toBe(
        true,
      );
    },
  );

  it("keeps the JS fallback available for browser selftests", () => {
    expect(shouldFailClosedOnUsdPreviewDecisionFailure("usda", false)).toBe(
      false,
    );
  });

  it("keeps the USDC JS fallback available for browser selftests", () => {
    expect(shouldFailClosedOnUsdPreviewDecisionFailure("usdc", false)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// readUsdzFirstFileName
// ---------------------------------------------------------------------------

describe("readUsdzFirstFileName", () => {
  /**
   * Builds a minimal ZIP local file header so we can test the parser without
   * a real USDZ archive. Layout (all little-endian):
   *   0x00  PK\x03\x04  local file header signature
   *   0x04  version (2 bytes)
   *   0x06  flags (2 bytes)
   *   0x08  compression (2 bytes)
   *   0x0A  mod time (2 bytes)
   *   0x0C  mod date (2 bytes)
   *   0x0E  crc32 (4 bytes)
   *   0x12  compressed size (4 bytes)
   *   0x16  uncompressed size (4 bytes)
   *   0x1A  file name length (2 bytes)  ← offset 26
   *   0x1C  extra field length (2 bytes) ← offset 28
   *   0x1E  file name bytes
   */
  function makeZipHeader(fileName: string): ArrayBuffer {
    const nameBytes = new TextEncoder().encode(fileName);
    const bufferSize = 30 + nameBytes.byteLength;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    // Signature: PK\x03\x04
    view.setUint32(0, 0x04034b50, true);
    // file name length
    view.setUint16(26, nameBytes.byteLength, true);
    // extra field length = 0
    view.setUint16(28, 0, true);
    // file name content
    u8.set(nameBytes, 30);

    return buffer;
  }

  it("returns the file name from a valid ZIP local header", () => {
    const buffer = makeZipHeader("scene.usda");
    expect(readUsdzFirstFileName(buffer)).toBe("scene.usda");
  });

  it("returns null for a buffer without ZIP signature", () => {
    const buffer = new ArrayBuffer(64);
    expect(readUsdzFirstFileName(buffer)).toBeNull();
  });

  it("returns null for a buffer shorter than 30 bytes", () => {
    const buffer = new ArrayBuffer(10);
    expect(readUsdzFirstFileName(buffer)).toBeNull();
  });

  it("returns null when file name length is 0", () => {
    const buffer = makeZipHeader("");
    // Override file name length to 0 explicitly
    new DataView(buffer).setUint16(26, 0, true);
    expect(readUsdzFirstFileName(buffer)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapWithConcurrency
// ---------------------------------------------------------------------------

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
