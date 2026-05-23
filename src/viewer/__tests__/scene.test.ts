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
  SkinnedMesh,
  Texture,
} from "three";
import { describe, expect, it } from "vitest";
import {
  applyBackfaceCulling,
  applyDisplayMode,
  applyUnlitMaterial,
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

    expect(material.wireframe).toBe(true);
    expect(material.color.getHexString()).toBe("5e6ad2");
    expect(material.map).toBeNull();
    expect(
      mesh.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);

    applyDisplayMode(root, "textured");

    expect(material.wireframe).toBe(false);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(material.map).toBe(texture);
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

  it("restores authored color after wireframe and unlit toggles", () => {
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
    expect(unlitMaterial.color.getHexString()).toBe("ff3300");
    expect(unlitMaterial.wireframe).toBe(false);

    applyUnlitMaterial(root, false);

    expect(mesh.material).toBe(material);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(material.wireframe).toBe(false);
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
    expect(regularMaterial.wireframe).toBe(true);
    expect(regular.material).not.toBe(regularMaterial);
    expect(renderProxyMaterial.side).toBe(DoubleSide);
    expect(renderProxyMaterial.wireframe).toBe(true);
    expect(renderProxy.material).not.toBe(renderProxyMaterial);
    expect(outlineMaterial.side).toBe(BackSide);
    expect(outlineMaterial.wireframe).toBe(true);
    expect(outline.material).toBe(outlineMaterial);

    applyDisplayMode(root, "textured");

    expect(outlineMaterial.wireframe).toBe(false);
  });
});
