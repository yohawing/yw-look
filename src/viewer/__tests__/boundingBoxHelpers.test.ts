import {
  Bone,
  Box3,
  Box3Helper,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ObjectLoader,
  PerspectiveCamera,
  Scene,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { describe, expect, it, vi } from "vitest";
import {
  applyBoundingBoxHelpers,
  applyInitialView,
  applySurfaceMaterialMode,
  disposeObject,
  isViewportHelperObject,
  getMaterials,
  removeBoundingBoxHelpers,
} from "../scene";

function objectLoaderSkinnedFixture() {
  const sourceRoot = new Group();
  sourceRoot.position.x = 3;
  sourceRoot.updateMatrix();
  sourceRoot.matrixAutoUpdate = false;
  const bindNode = new Group();
  bindNode.position.y = 10;
  sourceRoot.add(bindNode);

  const bone = new Bone();
  bindNode.add(bone);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array([-1, -1, -1, 1, 1, 1]), 3),
  );
  geometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(new Uint16Array(8), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]), 4),
  );
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  bindNode.add(mesh);
  sourceRoot.updateMatrixWorld(true);
  mesh.bind(new Skeleton([bone]));

  const root = new ObjectLoader().parse(sourceRoot.toJSON()) as Group;
  const restoredMesh = root.getObjectByProperty(
    "isSkinnedMesh",
    true,
  ) as SkinnedMesh;
  const restoredBone = root.getObjectByProperty("isBone", true) as Bone;
  const scene = new Scene();
  scene.add(root);
  return { scene, root, mesh: restoredMesh, bone: restoredBone };
}

function cameraControls() {
  return {
    target: new Vector3(),
    minDistance: 0,
    maxDistance: 0,
    rotateSpeed: 0,
    panSpeed: 0,
    zoomSpeed: 0,
    update: vi.fn(),
  } as unknown as OrbitControls;
}

function skinnedWorldBounds(mesh: SkinnedMesh) {
  const bounds = new Box3();
  for (
    let index = 0;
    index < mesh.geometry.attributes.position.count;
    index++
  ) {
    bounds.expandByPoint(
      mesh
        .getVertexPosition(index, new Vector3())
        .applyMatrix4(mesh.matrixWorld),
    );
  }
  return bounds;
}

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
  it("matches ObjectLoader-restored skinned display bounds after load and pose changes", () => {
    const { scene, root, mesh, bone } = objectLoaderSkinnedFixture();
    const camera = new PerspectiveCamera(50, 1, 0.01, 100);
    const controls = cameraControls();

    expect(root.matrixAutoUpdate).toBe(false);
    expect(new Vector3().setFromMatrixPosition(root.matrixWorld).x).toBe(0);
    applyInitialView(camera, controls, root);
    expect(new Vector3().setFromMatrixPosition(root.matrixWorld).x).toBe(3);
    const initialExpected = skinnedWorldBounds(mesh);
    expect(
      controls.target.equals(initialExpected.getCenter(new Vector3())),
    ).toBe(true);

    applyBoundingBoxHelpers(scene, root, true);
    expect(helpers(scene)[0].box.equals(initialExpected)).toBe(true);
    mesh.computeBoundingSphere();

    bone.position.y = 4;
    applyBoundingBoxHelpers(scene, root, true);
    const expected = skinnedWorldBounds(mesh);
    expect(helpers(scene)[0].box.equals(expected)).toBe(true);
    expect(expected.getCenter(new Vector3()).y).toBe(14);

    bone.position.y = 6;
    scene.position.y = 2;
    applyInitialView(camera, controls, root);
    expect(
      controls.target.equals(skinnedWorldBounds(mesh).getCenter(new Vector3())),
    ).toBe(true);

    camera.updateMatrixWorld(true);
    const projectionView = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    expect(
      new Frustum()
        .setFromProjectionMatrix(projectionView)
        .intersectsObject(mesh),
    ).toBe(true);

    removeBoundingBoxHelpers(scene);
    disposeObject(root);
  });

  it.each([0.00001, 1, 100000])(
    "keeps world bounds and a screen-space rim at model scale %s",
    (scale) => {
      const { scene, root, mesh } = fixture(scale);
      const getVertexPosition = vi.spyOn(mesh, "getVertexPosition");
      applyBoundingBoxHelpers(scene, root, true);
      expect(getVertexPosition).not.toHaveBeenCalled();
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
