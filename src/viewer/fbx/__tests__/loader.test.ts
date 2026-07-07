import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
} from "three";
import { FBXLoader } from "../../../vendor/FBXLoaderPatched.js";
import { formatMissingTextureWarnings } from "../../textureWarnings";
import {
  applyMissingTextureMaterialFallback,
  registerFbxTextureMaterialFallbacks,
  resolveMissingTextureLabel,
} from "../loader";

function readFixtureArrayBuffer(...segments: string[]): ArrayBuffer {
  const bytes = readFileSync(resolve(process.cwd(), ...segments));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

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
    expect(clip.duration).toBeGreaterThan(0);
    expect(clip.tracks.length).toBeGreaterThan(0);
  });
});

describe("FBX missing texture fallback", () => {
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
