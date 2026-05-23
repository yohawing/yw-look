import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  LineBasicMaterial,
  LineSegments,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SkinnedMesh,
  Texture,
} from "three";
import { describe, expect, it } from "vitest";
import {
  applyBackfaceCulling,
  applyDisplayMode,
  applyUnlitMaterial,
  applyVertexColors,
} from "../scene";

describe("scene material display helpers", () => {
  it("renders textured wireframe as a mesh with a line overlay", () => {
    const root = new Group();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ color: 0xff3300, map: texture });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(mesh);

    applyDisplayMode(root, "texturedWireframe");

    const overlays = mesh.children.filter(
      (child): child is LineSegments => child instanceof LineSegments,
    );
    const overlayMaterial = overlays[0].material;
    expect(material.wireframe).toBe(false);
    expect(material.map).toBe(texture);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].renderOrder).toBe(mesh.renderOrder + 1);
    expect(overlayMaterial).toBeInstanceOf(LineBasicMaterial);
    expect((overlayMaterial as LineBasicMaterial).color.getHexString()).toBe(
      "5e6ad2",
    );
    expect((overlayMaterial as LineBasicMaterial).opacity).toBe(0.78);

    applyDisplayMode(root, "texturedWireframe");

    expect(
      mesh.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(1);

    applyDisplayMode(root, "wireframe");

    const wireframeMaterial = mesh.material as unknown as MeshBasicMaterial;
    expect(wireframeMaterial).toBeInstanceOf(MeshBasicMaterial);
    expect(wireframeMaterial).not.toBe(material);
    expect(wireframeMaterial.wireframe).toBe(true);
    expect(wireframeMaterial.color.getHexString()).toBe("f7f8f8");
    expect(wireframeMaterial.map).toBeNull();
    expect(wireframeMaterial.toneMapped).toBe(false);
    expect(material.wireframe).toBe(false);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(material.map).toBe(texture);
    expect(
      mesh.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);

    applyDisplayMode(root, "textured");

    expect(mesh.material).toBe(material);
    expect(material.wireframe).toBe(false);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(material.map).toBe(texture);
  });

  it("uses unlit neutral wireframe materials for lit source materials", () => {
    const root = new Group();
    const material = new MeshStandardMaterial({ color: 0x2288ff });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(mesh);

    applyDisplayMode(root, "wireframe");

    const wireframeMaterial = mesh.material as unknown as MeshBasicMaterial;
    expect(wireframeMaterial).toBeInstanceOf(MeshBasicMaterial);
    expect(wireframeMaterial.wireframe).toBe(true);
    expect(wireframeMaterial.color.getHexString()).toBe("f7f8f8");
    expect(wireframeMaterial.toneMapped).toBe(false);
    expect(material.wireframe).toBe(false);
    expect(material.color.getHexString()).toBe("2288ff");

    applyDisplayMode(root, "textured");

    expect(mesh.material).toBe(material);
  });

  it("preserves authored hidden material state in wireframe mode", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({
      color: 0xff3300,
      opacity: 0,
      transparent: true,
    });
    material.visible = false;
    const mesh = new Mesh(new BufferGeometry(), material);
    root.add(mesh);

    applyDisplayMode(root, "wireframe");

    const wireframeMaterial = mesh.material as MeshBasicMaterial;
    expect(wireframeMaterial.visible).toBe(false);
    expect(wireframeMaterial.transparent).toBe(true);
    expect(wireframeMaterial.opacity).toBe(0);
  });

  it("keeps deformed textured wireframes on the material path", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ color: 0xff3300 });
    const skinned = new SkinnedMesh(new BufferGeometry(), material);
    skinned.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(skinned);

    applyDisplayMode(root, "texturedWireframe");

    expect(material.wireframe).toBe(true);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(
      skinned.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);
  });

  it("keeps instanced textured wireframes on the material path", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ color: 0xff3300 });
    const instanced = new InstancedMesh(new BufferGeometry(), material, 2);
    instanced.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(instanced);

    applyDisplayMode(root, "texturedWireframe");

    expect(material.wireframe).toBe(true);
    expect(
      instanced.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);
  });

  it("honors unlit toggles made while wireframe mode is active", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ color: 0xff3300 });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(mesh);

    applyDisplayMode(root, "wireframe");
    applyUnlitMaterial(root, true);
    applyDisplayMode(root, "textured");

    const unlitMaterial = mesh.material as MeshBasicMaterial;
    expect(unlitMaterial).toBeInstanceOf(MeshBasicMaterial);
    expect(unlitMaterial).not.toBe(material);
    expect(unlitMaterial.color.getHexString()).toBe("ff3300");
    expect(unlitMaterial.wireframe).toBe(false);

    applyUnlitMaterial(root, false);

    expect(mesh.material).toBe(material);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(material.wireframe).toBe(false);
  });

  it("applies material controls to stored originals while wireframe mode is active", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ side: FrontSide });
    const mesh = new Mesh(new BufferGeometry(), material);
    root.add(mesh);

    applyDisplayMode(root, "wireframe");
    applyBackfaceCulling(root, false);
    applyDisplayMode(root, "textured");

    expect(mesh.material).toBe(material);
    expect(material.side).toBe(DoubleSide);
  });

  it("preserves vertex color toggles made while wireframe mode is active", () => {
    const root = new Group();
    const material = new MeshBasicMaterial();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    geometry.setAttribute(
      "color",
      new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
    );
    const mesh = new Mesh(geometry, material);
    root.add(mesh);

    applyDisplayMode(root, "wireframe");
    applyVertexColors(root, true);
    applyDisplayMode(root, "textured");

    expect(mesh.material).toBe(material);
    expect(material.vertexColors).toBe(true);
  });

  it("keeps MMD outline materials out of global lighting toggles but applies wireframe display", () => {
    const root = new Group();
    const regularMaterial = new MeshBasicMaterial({ side: FrontSide });
    const renderProxyMaterial = new MeshBasicMaterial({ side: FrontSide });
    const outlineMaterial = new MeshBasicMaterial({ side: BackSide });
    outlineMaterial.userData.mmdOutlineMaterial = {};

    const regular = new Mesh(new BufferGeometry(), regularMaterial);
    const renderProxy = new Mesh(new BufferGeometry(), renderProxyMaterial);
    renderProxy.userData.mmdMaterialRenderProxy = { materialIndex: 0 };
    const outline = new Mesh(new BufferGeometry(), outlineMaterial);
    outline.userData.mmdOutlineProxy = { source: "combined" };
    root.add(regular, renderProxy, outline);

    applyBackfaceCulling(root, false);
    applyDisplayMode(root, "wireframe");
    applyUnlitMaterial(root, true);

    expect(regularMaterial.side).toBe(DoubleSide);
    expect(regularMaterial.wireframe).toBe(false);
    expect(regular.material).not.toBe(regularMaterial);
    expect((regular.material as MeshBasicMaterial).wireframe).toBe(true);
    expect(renderProxyMaterial.side).toBe(DoubleSide);
    expect(renderProxyMaterial.wireframe).toBe(false);
    expect(renderProxy.material).not.toBe(renderProxyMaterial);
    expect(outlineMaterial.side).toBe(BackSide);
    expect(outlineMaterial.wireframe).toBe(false);
    expect(outline.material).not.toBe(outlineMaterial);
    expect((outline.material as MeshBasicMaterial).wireframe).toBe(true);

    applyDisplayMode(root, "textured");

    expect(outline.material).toBe(outlineMaterial);
    expect(outlineMaterial.wireframe).toBe(false);
  });

  it("preserves material-only MMD outline identity in wireframe mode", () => {
    const root = new Group();
    const outlineMaterial = new MeshBasicMaterial({ side: BackSide });
    outlineMaterial.userData.mmdOutlineMaterial = { materialIndex: 0 };
    const outline = new Mesh(new BufferGeometry(), outlineMaterial);
    outline.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(outline);

    applyDisplayMode(root, "wireframe");

    const wireframeMaterial = outline.material as MeshBasicMaterial;
    expect(wireframeMaterial).not.toBe(outlineMaterial);
    expect(wireframeMaterial.wireframe).toBe(true);
    expect(wireframeMaterial.userData.mmdOutlineMaterial).toBe(
      outlineMaterial.userData.mmdOutlineMaterial,
    );

    applyBackfaceCulling(root, false);
    applyDisplayMode(root, "texturedWireframe");

    expect(outline.material).toBe(outlineMaterial);
    expect(outlineMaterial.side).toBe(BackSide);
    expect(
      outline.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);
  });
});
