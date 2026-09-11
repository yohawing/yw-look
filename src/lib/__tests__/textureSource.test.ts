import { describe, expect, it } from "vitest";
import {
  texturePackageSource,
  textureSourceFileName,
  textureSourceIdentity,
} from "../textureSource";

describe("texture source display and identity", () => {
  it.each([
    [String.raw`\\?\F:\assets\toy.usdz[0/normal.png]`, "normal.png"],
    ["F:/assets/toy.usdz[a/normal.png]", "normal.png"],
    ["F:/assets/toy.usdz[a/%E8%85%95%20normal.png]", "腕 normal.png"],
    ["F:/assets/toy.usdz%5Ba%2Fnormal.png%5D", "normal.png"],
    ["F:/assets/toy.usdz[a/normal%2520.png]", "normal%20.png"],
    [String.raw`\\?\F:\textures\normal.png`, "normal.png"],
    ["https://example.test/normal.png?version=2#view", "normal.png"],
  ])("extracts a display filename from %s", (source, name) => {
    expect(textureSourceFileName(source)).toBe(name);
  });

  it("keeps package and native path identities distinct", () => {
    const sources = [
      String.raw`\\?\F:\one.usdz[a/same.png]`,
      String.raw`\\?\F:\one.usdz[b/same.png]`,
      String.raw`\\?\F:\two.usdz[a/same.png]`,
      "one.usdz[a/x#1.png]",
      "one.usdz[a/x#2.png]",
    ];
    expect(new Set(sources.map(textureSourceIdentity)).size).toBe(
      sources.length,
    );
    expect(texturePackageSource(sources[0])).toEqual({
      containerPath: String.raw`\\?\F:\one.usdz`,
      internalPath: "a/same.png",
    });
    expect(texturePackageSource("ordinary.png")).toBeNull();
  });
});
