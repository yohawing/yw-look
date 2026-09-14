import { describe, expect, it } from "vitest";
import { Texture } from "three";
import { shouldFlipTexturePreviewY } from "../renderSettings";

describe("shouldFlipTexturePreviewY", () => {
  it("flips the display UV for glTF-style unflipped images without changing the texture", () => {
    const texture = new Texture();
    texture.flipY = false;

    expect(shouldFlipTexturePreviewY(texture)).toBe(true);
    expect(texture.flipY).toBe(false);
  });

  it("keeps the default Three.js image orientation", () => {
    const texture = new Texture();

    expect(shouldFlipTexturePreviewY(texture)).toBe(false);
    expect(texture.flipY).toBe(true);
  });
});
