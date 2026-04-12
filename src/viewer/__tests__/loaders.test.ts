/**
 * Unit tests for pure helper functions in src/viewer/loaders.ts.
 *
 * The full `loadPreviewObject` function is NOT tested here because it
 * requires Three.js WebGL context, Tauri IPC, and real binary assets —
 * none of which are available in jsdom. Instead we test the pure
 * utilities that are exported with the @internal tag.
 */

import { describe, it, expect } from "vitest";
import {
  getMimeType,
  resolveSiblingPath,
  isUsdcCrateBuffer,
  readUsdzFirstFileName,
} from "../loaders";

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
