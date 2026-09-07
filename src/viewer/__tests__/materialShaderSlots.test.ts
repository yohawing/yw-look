/**
 * Tests for shader-input-slot extraction in buildMaterialEntry (#36).
 *
 * Verifies that collectAssetMetadata populates the new MaterialEntry fields
 * (baseColorFactor, metallicFactor, roughnessFactor, emissiveFactor,
 * baseColorTexture, metallicRoughnessTexture, normalTexture, emissiveTexture,
 * alphaMode, usdPrimPath) correctly for each supported material type.
 */

import { describe, it, expect } from "vitest";
import {
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Texture,
} from "three";
import { collectAssetMetadata } from "../metadata";
import type { SelectedFile } from "../../lib/files";

const fakeFile: SelectedFile = {
  path: "/tmp/fake.glb",
  fileName: "fake.glb",
  extension: "glb",
  kind: "model",
  parentDirectory: "/tmp",
};

function singleMeshScene(
  material: MeshBasicMaterial | MeshPhongMaterial | MeshStandardMaterial,
) {
  const root = new Group();
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.name = "TestMesh";
  root.add(mesh);
  return root;
}

describe("MaterialEntry shader slot extraction (#36)", () => {
  it("keeps same-name USD materials distinct without mutating their source names", () => {
    const root = new Group();
    const mats = ["usd:/World/A/Paint", "usd:/World/B/Paint"].map((name) => {
      const mat = new MeshStandardMaterial();
      mat.name = name;
      root.add(new Mesh(new BufferGeometry(), mat));
      return mat;
    });
    const entries = collectAssetMetadata(
      root,
      { ...fakeFile, extension: "usdz" },
      [],
      null,
    ).metadata.materials;
    expect(entries.map((entry) => entry.name)).toEqual(["Paint", "Paint"]);
    expect(entries.map((entry) => entry.usdPrimPath)).toEqual([
      "/World/A/Paint",
      "/World/B/Paint",
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
    expect(mats.map((mat) => mat.name)).toEqual([
      "usd:/World/A/Paint",
      "usd:/World/B/Paint",
    ]);
  });

  it("prefers an authored USD display name", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "usd:/Looks/Paint";
    mat.userData.displayName = "赤い塗装";
    const entry = collectAssetMetadata(
      singleMeshScene(mat),
      { ...fakeFile, extension: "usdc" },
      [],
      null,
    ).metadata.materials[0];
    expect(entry.name).toBe("赤い塗装");
    expect(entry.usdPrimPath).toBe("/Looks/Paint");
  });

  it.each(["glb", "fbx", "pmx"])(
    "preserves authored %s material names that resemble a USD identifier",
    (extension) => {
      const mat = new MeshStandardMaterial();
      mat.name = "usd:/Artist/Paint";
      const entry = collectAssetMetadata(
        singleMeshScene(mat),
        { ...fakeFile, extension },
        [],
        null,
      ).metadata.materials[0];
      expect(entry.name).toBe(mat.name);
      expect(entry.usdPrimPath).toBeNull();
    },
  );

  it("shortens package texture slots while retaining complete locators", () => {
    const mat = new MeshStandardMaterial();
    const texture = new Texture();
    texture.name = String.raw`\\?\F:\toy.usdz[0/normal.png]`;
    mat.map = texture;
    mat.normalMap = texture;
    const entry = collectAssetMetadata(
      singleMeshScene(mat),
      { ...fakeFile, extension: "usdz" },
      [],
      null,
    ).metadata.materials[0];
    expect(entry.baseColorTexture).toEqual({
      name: "normal.png",
      sourcePath: texture.name,
    });
    expect(entry.normalTexture).toEqual(entry.baseColorTexture);
  });
  it("extracts baseColorFactor from MeshStandardMaterial", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "Std";
    mat.color = new Color(0.5, 0.25, 0.1);
    mat.opacity = 0.8;
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    const entry = result.metadata.materials[0];
    expect(entry.baseColorFactor).not.toBeNull();
    expect(entry.baseColorFactor![0]).toBeCloseTo(0.5);
    expect(entry.baseColorFactor![1]).toBeCloseTo(0.25);
    expect(entry.baseColorFactor![2]).toBeCloseTo(0.1);
    expect(entry.baseColorFactor![3]).toBeCloseTo(0.8);
  });

  it("extracts metallicFactor and roughnessFactor from MeshStandardMaterial", () => {
    const mat = new MeshStandardMaterial({ metalness: 0.7, roughness: 0.3 });
    mat.name = "Metal";
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    const entry = result.metadata.materials[0];
    expect(entry.metallicFactor).toBeCloseTo(0.7);
    expect(entry.roughnessFactor).toBeCloseTo(0.3);
  });

  it("sets metallicFactor/roughnessFactor to null for MeshBasicMaterial", () => {
    const mat = new MeshBasicMaterial({ color: 0xff0000 });
    mat.name = "Basic";
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    const entry = result.metadata.materials[0];
    expect(entry.metallicFactor).toBeNull();
    expect(entry.roughnessFactor).toBeNull();
  });

  it("extracts emissiveFactor from MeshStandardMaterial", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "Emissive";
    mat.emissive = new Color(0.0, 1.0, 0.5);
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    const entry = result.metadata.materials[0];
    expect(entry.emissiveFactor).not.toBeNull();
    expect(entry.emissiveFactor![1]).toBeCloseTo(1.0);
  });

  it("extracts baseColorTexture name from MeshStandardMaterial.map", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "Textured";
    const tex = new Texture();
    tex.name = "MyAlbedo";
    mat.map = tex;
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    const entry = result.metadata.materials[0];
    expect(entry.baseColorTexture).not.toBeNull();
    expect(entry.baseColorTexture!.name).toBe("MyAlbedo");
  });

  it("falls back to slot label when texture name is empty", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "NoTexName";
    const tex = new Texture();
    tex.name = "";
    mat.map = tex;
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    const entry = result.metadata.materials[0];
    expect(entry.baseColorTexture!.name).toBe("Base Color");
  });

  it("uses userData.path as texture name fallback", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "PathFallback";
    const tex = new Texture();
    tex.name = "";
    (tex.userData as Record<string, unknown>).path = "/textures/diffuse.png";
    mat.map = tex;
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    const entry = result.metadata.materials[0];
    expect(entry.baseColorTexture).toEqual({
      name: "diffuse.png",
      sourcePath: "/textures/diffuse.png",
    });
  });

  it("infers alphaMode BLEND for transparent material", () => {
    const mat = new MeshStandardMaterial({ transparent: true, opacity: 0.5 });
    mat.name = "Blend";
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    expect(result.metadata.materials[0].alphaMode).toBe("BLEND");
  });

  it("infers alphaMode MASK when alphaTest > 0", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "Mask";
    mat.alphaTest = 0.5;
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    expect(result.metadata.materials[0].alphaMode).toBe("MASK");
  });

  it("infers alphaMode OPAQUE by default", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "Opaque";
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    expect(result.metadata.materials[0].alphaMode).toBe("OPAQUE");
  });

  it("prefers gltfAlphaMode from userData over heuristic", () => {
    const mat = new MeshStandardMaterial({ transparent: true });
    mat.name = "GltfAlpha";
    (mat.userData as Record<string, unknown>).gltfAlphaMode = "MASK";
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    expect(result.metadata.materials[0].alphaMode).toBe("MASK");
  });

  it("extracts usdPrimPath from userData when present", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "UsdMat";
    (mat.userData as Record<string, unknown>).usdPrimPath =
      "/World/Materials/Gold";
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    expect(result.metadata.materials[0].usdPrimPath).toBe(
      "/World/Materials/Gold",
    );
  });

  it("sets usdPrimPath to null when not in userData", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "NoUsd";
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    expect(result.metadata.materials[0].usdPrimPath).toBeNull();
  });

  it("extracts normalTexture from MeshStandardMaterial", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "Normal";
    const tex = new Texture();
    tex.name = "NormalMap";
    mat.normalMap = tex;
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    expect(result.metadata.materials[0].normalTexture).toEqual({
      name: "NormalMap",
    });
  });

  it("extracts metallicRoughnessTexture from MeshStandardMaterial.metalnessMap", () => {
    const mat = new MeshStandardMaterial();
    mat.name = "MetRough";
    const tex = new Texture();
    tex.name = "ORM";
    mat.metalnessMap = tex;
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    expect(result.metadata.materials[0].metallicRoughnessTexture).toEqual({
      name: "ORM",
    });
  });

  it("extracts baseColorFactor from MeshPhongMaterial", () => {
    const mat = new MeshPhongMaterial({ color: 0x00ff00 });
    mat.name = "Phong";
    const result = collectAssetMetadata(
      singleMeshScene(mat),
      fakeFile,
      [],
      null,
    );
    const entry = result.metadata.materials[0];
    expect(entry.baseColorFactor).not.toBeNull();
    expect(entry.baseColorFactor![1]).toBeCloseTo(1.0); // green
    expect(entry.metallicFactor).toBeNull(); // Phong has no metalness
  });
});
