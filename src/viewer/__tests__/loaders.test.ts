/**
 * Unit tests for pure helper functions in src/viewer/loaders.ts.
 *
 * The full `loadPreviewObject` function is NOT tested here because it
 * requires Three.js WebGL context, Tauri IPC, and real binary assets —
 * none of which are available in jsdom. Instead we test the pure
 * utilities that are exported with the @internal tag.
 */

import { describe, it, expect } from "vitest";
import { BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
import {
  getMimeType,
  listRegisteredLoaders,
  resolveSiblingPath,
  isUsdcCrateBuffer,
  readUsdzFirstFileName,
  shouldFailClosedOnUsdPreviewDecisionFailure,
  applyMissingGltfTextureFallbacks,
  applyMissingTextureMaterialFallback,
  formatMissingTextureWarnings,
  registerFbxTextureMaterialFallbacks,
  resolveColladaTextureUrl,
  type GltfDocument,
} from "../loaders";
import {
  formatMissingOptionalLoaderMessage,
  formatUnsupportedFormatMessage,
  getPreviewSupportState,
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
    expect(extensions.has("ktx2")).toBe(true);
  });

  it("classifies implemented core loaders separately from optional packs", () => {
    expect(getPreviewSupportState("glb")).toBe("implemented");
    expect(getPreviewSupportState("vrm")).toBe("implemented");
    expect(getPreviewSupportState("vrma")).toBe("missingOptionalLoader");
    expect(getPreviewSupportState("pmx")).toBe("missingOptionalLoader");
    expect(getPreviewSupportState("abc")).toBe("missingOptionalLoader");
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

  it("keeps unknown extensions in the generic unsupported bucket", () => {
    expect(getPreviewSupportState("assetbundle")).toBe("unsupported");
  });

  it("formats missing optional loader copy without exposing technical details", () => {
    expect(formatMissingOptionalLoaderMessage("vrm")).toEqual({
      title: "VRM Loader Pack is not installed.",
      body: "Install VRM Loader Pack to preview VRM files.",
    });
  });

  it("formats unsupported extension copy with the attempted extension", () => {
    expect(formatUnsupportedFormatMessage("assetbundle").body).toContain(
      ".assetbundle",
    );
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
  it.each(["usd", "usda", "usdz"])(
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

  it("does not change the existing USDC fail-fast path", () => {
    expect(shouldFailClosedOnUsdPreviewDecisionFailure("usdc", true)).toBe(
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
