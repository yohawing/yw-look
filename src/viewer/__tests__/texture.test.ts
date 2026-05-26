import { describe, expect, it } from "vitest";
import { ShaderMaterial, Texture } from "three";
import { createTextureViewerObject } from "../texture";

describe("createTextureViewerObject", () => {
  it("passes display-only vertical flipping to the shader without mutating the texture", () => {
    const texture = new Texture();
    texture.flipY = false;

    const object = createTextureViewerObject(
      texture,
      "rgb",
      0,
      0,
      1,
      1,
      1,
      true,
    );

    const material = object.material as ShaderMaterial;
    expect(material.uniforms.uPreviewFlipY.value).toBe(true);
    expect(texture.flipY).toBe(false);
  });
});
