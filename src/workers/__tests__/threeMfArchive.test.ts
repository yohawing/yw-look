// @vitest-environment node
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";
import { packagePath, unpackThreeMf } from "../threeMfArchive";

function archive(files: Record<string, Uint8Array>, level: 0 | 6 = 6) {
  const zip = zipSync(files, { level });
  return zip.slice().buffer as ArrayBuffer;
}

describe("3MF package validation", () => {
  it("reads stored and compressed UTF-8 package entries", () => {
    for (const level of [0, 6] as const) {
      const result = unpackThreeMf(
        archive(
          { "3D/model.model": strToU8("<model/>"), "3D/": new Uint8Array() },
          level,
        ),
      );
      expect(new TextDecoder().decode(result["3D/model.model"])).toBe(
        "<model/>",
      );
    }
  });
  it.each([
    "../bad",
    "/../bad",
    "//bad",
    "a/../b",
    "a\\b",
    "https://host/a",
    "a%2fb",
    "a//b",
    "a?b",
  ])("rejects unsafe package references: %s", (name) => {
    expect(() => packagePath(name)).toThrow(/unsafe/);
  });
  it("accepts root-relative part references, but rejects absolute archive entries", () => {
    expect(packagePath("/3D/model.model")).toBe("3D/model.model");
    expect(() =>
      unpackThreeMf(archive({ "/3D/model.model": strToU8("x") })),
    ).toThrow(/absolute/);
  });
  it("rejects case-insensitive duplicate part names", () => {
    expect(() =>
      unpackThreeMf(
        archive({ "a.model": strToU8("a"), "A.model": strToU8("b") }),
      ),
    ).toThrow(/duplicate/);
  });
  it("detects corrupt stored content even if inflation succeeds", () => {
    const buffer = archive({ "a.model": strToU8("<model/>") }, 0);
    const bytes = new Uint8Array(buffer);
    bytes[30 + "a.model".length] ^= 1;
    expect(() => unpackThreeMf(buffer)).toThrow(/checksum/);
  });
  it("bounds actual inflation when declared sizes lie", () => {
    const buffer = archive({ "a.model": new Uint8Array(500_000) });
    const view = new DataView(buffer);
    const end = buffer.byteLength - 22;
    const central = view.getUint32(end + 16, true);
    view.setUint32(22, 1, true);
    view.setUint32(central + 24, 1, true);
    expect(() => unpackThreeMf(buffer)).toThrow(/exceeds/);
  });
  it("rejects oversized advertised entries before inflation", () => {
    const buffer = archive({ "a.model": strToU8("x") });
    const view = new DataView(buffer);
    const central = view.getUint32(buffer.byteLength - 6, true);
    view.setUint32(central + 24, 0x7fffffff, true);
    expect(() => unpackThreeMf(buffer)).toThrow(/oversized/);
  });
  it("rejects truncated and mismatched local headers", () => {
    const buffer = archive({ "a.model": strToU8("x") });
    expect(() => unpackThreeMf(buffer.slice(0, -1))).toThrow();
    new Uint8Array(buffer)[30] = 98;
    expect(() => unpackThreeMf(buffer)).toThrow(/different name/);
  });
});
