import {
  BackSide,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
} from "three";
import { describe, expect, it } from "vitest";
import {
  applyBackfaceCulling,
  applyDisplayMode,
  applyUnlitMaterial,
} from "../scene";

describe("scene material display helpers", () => {
  it("keeps MMD outline materials out of global material toggles", () => {
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
    expect(outlineMaterial.wireframe).toBe(false);
    expect(outline.material).toBe(outlineMaterial);
  });
});
