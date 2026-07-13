import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  applySelectionHighlightToObject,
  clearSelectionHighlightFromObject,
} from "../highlight";
import {
  applyDisplayMode,
  applySurfaceMaterialMode,
  disposeObject,
} from "../scene";

function createNormalGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  return geometry;
}

describe("selection highlight helpers", () => {
  it("skips viewport helper and MMD selection proxy meshes", () => {
    const root = new Group();
    const selectableMaterial = new MeshBasicMaterial({ color: 0xffffff });
    const helperMaterial = new MeshBasicMaterial({ color: 0xffffff });
    const proxyMaterial = new MeshBasicMaterial({ color: 0xffffff });

    const selectable = new Mesh(new BufferGeometry(), selectableMaterial);
    const helper = new Mesh(new BufferGeometry(), helperMaterial);
    const proxy = new Mesh(new BufferGeometry(), proxyMaterial);
    helper.userData.__yw_wireframe_proxy = true;
    proxy.userData.__ywSelectionProxyTarget = selectable;
    root.add(selectable, helper, proxy);

    applySelectionHighlightToObject(root);

    expect(selectable.material).not.toBe(selectableMaterial);
    expect(helper.material).toBe(helperMaterial);
    expect(proxy.material).toBe(proxyMaterial);

    clearSelectionHighlightFromObject(root);

    expect(selectable.material).toBe(selectableMaterial);
  });

  it("restores a pre-existing selection tint after leaving normals", () => {
    const authored = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const mesh = new Mesh(createNormalGeometry(), authored);
    const root = new Group().add(mesh);

    applySelectionHighlightToObject(root);
    const initialTint = mesh.material as MeshBasicMaterial[];
    const initialDisposals = initialTint.map((item) =>
      vi.spyOn(item, "dispose"),
    );

    applySurfaceMaterialMode(root, "normals");
    const normalMaterials = mesh.material as unknown as MeshNormalMaterial[];
    expect(
      normalMaterials.every((item) => item instanceof MeshNormalMaterial),
    ).toBe(true);
    expect(mesh.userData.__yw_origMaterial).toBeUndefined();
    expect(mesh.userData.__yw_selectionSuppressedByNormals).toBe(true);
    for (const dispose of initialDisposals) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }

    applySurfaceMaterialMode(root, "shaded");
    const restoredTint = mesh.material as MeshBasicMaterial[];
    expect(restoredTint).not.toBe(authored);
    expect(
      restoredTint.every((item) => item.userData.__yw_selectionClone),
    ).toBe(true);
    expect(mesh.userData.__yw_origMaterial).toBe(authored);
    expect(mesh.userData.__yw_selectionSuppressedByNormals).toBeUndefined();

    clearSelectionHighlightFromObject(root);
    expect(mesh.material).toBe(authored);
  });

  it("defers a selection made during normals and restores its visible tint", () => {
    const authored = new MeshBasicMaterial({ color: 0xffffff });
    const mesh = new Mesh(createNormalGeometry(), authored);
    const root = new Group().add(mesh);
    applySurfaceMaterialMode(root, "normals");
    const normal = mesh.material;

    applySelectionHighlightToObject(root);

    expect(mesh.material).toBe(normal);
    expect(mesh.userData.__yw_selectionSuppressedByNormals).toBe(true);
    const deferredTint = mesh.userData
      .__yw_selectionNormalTint as MeshBasicMaterial;

    applySurfaceMaterialMode(root, "shaded");

    expect(mesh.material).toBe(deferredTint);
    expect(mesh.userData.__yw_origMaterial).toBe(authored);
    clearSelectionHighlightFromObject(root);
    expect(mesh.material).toBe(authored);
  });

  it("clears and disposes a deferred array selection while normals stays active", () => {
    const authored = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const mesh = new Mesh(createNormalGeometry(), authored);
    const root = new Group().add(mesh);
    applySurfaceMaterialMode(root, "normals");
    const normalMaterials = mesh.material;
    applySelectionHighlightToObject(root);
    const deferredTint = mesh.userData
      .__yw_selectionNormalTint as MeshBasicMaterial[];
    const disposals = deferredTint.map((item) => vi.spyOn(item, "dispose"));

    clearSelectionHighlightFromObject(root);

    expect(mesh.material).toBe(normalMaterials);
    expect(mesh.userData.__yw_selectionNormalTint).toBeUndefined();
    for (const dispose of disposals) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }

    applySurfaceMaterialMode(root, "shaded");
    expect(mesh.material).toBe(authored);
  });

  it("restores and clears deferred tint under wireframe-only", () => {
    const authored = new MeshBasicMaterial();
    const mesh = new Mesh(createNormalGeometry(), authored);
    const root = new Group().add(mesh);
    applySurfaceMaterialMode(root, "normals");
    applySelectionHighlightToObject(root);
    const deferredTint = mesh.userData
      .__yw_selectionNormalTint as MeshBasicMaterial;
    const disposeTint = vi.spyOn(deferredTint, "dispose");
    applyDisplayMode(root, "wireframe");

    applySurfaceMaterialMode(root, "shaded");

    const wireframe = mesh.material;
    expect(mesh.userData.__yw_wireframe_original_material).toBe(deferredTint);
    expect(mesh.userData.__yw_origMaterial).toBe(authored);
    clearSelectionHighlightFromObject(root);
    expect(mesh.material).toBe(wireframe);
    expect(mesh.userData.__yw_wireframe_original_material).toBe(authored);
    expect(disposeTint).toHaveBeenCalledTimes(1);
    applyDisplayMode(root, "textured");
    expect(mesh.material).toBe(authored);
  });

  it("clears restored selection after leaving wireframe-only", () => {
    const authored = new MeshBasicMaterial();
    const mesh = new Mesh(createNormalGeometry(), authored);
    const root = new Group().add(mesh);
    applySurfaceMaterialMode(root, "normals");
    applySelectionHighlightToObject(root);
    applyDisplayMode(root, "wireframe");
    applySurfaceMaterialMode(root, "shaded");

    applyDisplayMode(root, "textured");
    const restoredTint = mesh.material as MeshBasicMaterial;
    const disposeTint = vi.spyOn(restoredTint, "dispose");
    expect(restoredTint).not.toBe(authored);
    expect(mesh.userData.__yw_origMaterial).toBe(authored);
    expect(mesh.userData.__yw_selectionWireframeTint).toBeUndefined();

    clearSelectionHighlightFromObject(root);

    expect(mesh.material).toBe(authored);
    expect(disposeTint).toHaveBeenCalledTimes(1);
  });

  it("disposes deferred tint arrays with the mounted asset", () => {
    const authored = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const mesh = new Mesh(createNormalGeometry(), authored);
    const root = new Group().add(mesh);
    applySurfaceMaterialMode(root, "normals");
    const normal = mesh.material as unknown as MeshNormalMaterial[];
    applySelectionHighlightToObject(root);
    const tint = mesh.userData.__yw_selectionNormalTint as MeshBasicMaterial[];
    const authoredDisposals = authored.map((item) => vi.spyOn(item, "dispose"));
    const normalDisposals = normal.map((item) => vi.spyOn(item, "dispose"));
    const tintDisposals = tint.map((item) => vi.spyOn(item, "dispose"));

    disposeObject(root);

    for (const dispose of [
      ...authoredDisposals,
      ...normalDisposals,
      ...tintDisposals,
    ]) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }
  });
});
