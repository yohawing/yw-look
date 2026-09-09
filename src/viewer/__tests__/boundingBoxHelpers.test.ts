import {
  Box3,
  Box3Helper,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { describe, expect, it, vi } from "vitest";
import {
  applyBoundingBoxHelpers,
  applySurfaceMaterialMode,
  disposeObject,
  isViewportHelperObject,
  getMaterials,
  removeBoundingBoxHelpers,
} from "../scene";

function fixture(scale = 1) {
  const scene = new Scene();
  const root = new Group();
  root.position.set(3, -2, 8);
  root.scale.setScalar(scale);
  const mesh = new Mesh(new BoxGeometry(1, 2, 3), new MeshStandardMaterial());
  mesh.rotation.set(0.2, 0.5, 0.8);
  root.add(mesh);
  scene.add(root);
  root.updateWorldMatrix(true, true);
  return { scene, root, mesh };
}

function helpers(scene: Scene) {
  return scene.children.filter(
    (object): object is Box3Helper => object instanceof Box3Helper,
  );
}

describe("bounding box contrast helpers", () => {
  it.each([0.00001, 1, 100000])(
    "keeps world bounds and a screen-space rim at model scale %s",
    (scale) => {
      const { scene, root, mesh } = fixture(scale);
      applyBoundingBoxHelpers(scene, root, true);
      scene.updateMatrixWorld(true);
      const [helper] = helpers(scene);
      expect(helper.box.equals(new Box3().setFromObject(mesh))).toBe(true);
      const rim = helper.children[0] as LineSegments2;
      expect(rim).toBeInstanceOf(LineSegments2);
      expect(rim.geometry.attributes.instanceStart.count).toBe(12);
      expect(rim.material.worldUnits).toBe(false);
      expect(rim.material.linewidth).toBe(2.5);
      expect(rim.matrixWorld.equals(helper.matrixWorld)).toBe(true);
      expect(isViewportHelperObject(rim)).toBe(true);
      expect(rim.renderOrder).toBeLessThan(helper.renderOrder);
      const center = helper.children[1] as LineSegments2;
      expect(center.geometry).toBe(rim.geometry);
      expect(center.material.linewidth).toBe(1);
      expect(isViewportHelperObject(center)).toBe(true);
      for (const material of [center.material, rim.material]) {
        expect(material.depthTest).toBe(false);
        expect(material.depthWrite).toBe(false);
        expect(material.toneMapped).toBe(false);
      }
      removeBoundingBoxHelpers(scene);
      disposeObject(root);
    },
  );

  it("disposes both line layers exactly once when replacing or hiding boxes, without touching the asset", () => {
    const { scene, root, mesh } = fixture();
    const sourceGeometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const sourceMaterialDispose = vi.spyOn(mesh.material, "dispose");
    applyBoundingBoxHelpers(scene, root, true);
    const [oldHelper] = helpers(scene);
    const oldRim = oldHelper.children[0] as LineSegments2;
    const disposed = [
      oldHelper.geometry,
      ...getMaterials(oldHelper.material),
      oldRim.geometry,
      oldRim.material,
      (oldHelper.children[1] as LineSegments2).material,
    ].map((resource) => vi.spyOn(resource, "dispose"));
    applyBoundingBoxHelpers(scene, root, true);
    expect(helpers(scene)).toHaveLength(1);
    expect(oldHelper.parent).toBeNull();
    disposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    applyBoundingBoxHelpers(scene, root, false);
    removeBoundingBoxHelpers(scene);
    expect(helpers(scene)).toHaveLength(0);
    disposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(sourceGeometryDispose).not.toHaveBeenCalled();
    expect(sourceMaterialDispose).not.toHaveBeenCalled();
    disposeObject(root);
  });

  it("excludes the rim mesh from surface modes and never creates helper boxes for it", () => {
    const { scene, root } = fixture();
    applyBoundingBoxHelpers(scene, root, true);
    const helper = helpers(scene)[0];
    const rim = helper.children[0] as LineSegments2;
    const original = rim.material;
    for (const mode of [
      "unlit",
      "normals",
      "vertexColors",
      "shaded",
    ] as const) {
      applySurfaceMaterialMode(scene as unknown as Group, mode);
      expect(rim.material).toBe(original);
    }
    applyBoundingBoxHelpers(scene, root, true);
    expect(helpers(scene)).toHaveLength(1);
    removeBoundingBoxHelpers(scene);
    disposeObject(root);
  });
});
