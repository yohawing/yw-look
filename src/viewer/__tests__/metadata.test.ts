/**
 * Regression tests for src/viewer/metadata.ts.
 *
 * Background: ColladaLoader can leave Object3D.name as `null` (rather than
 * the empty string) when the source document has no name attribute. The
 * earlier `object.name.trim()` call threw a TypeError on such inputs and the
 * load failure was masked by the AssetViewport overlay logic, so the user
 * saw a stuck "Loading" state instead of an error message.
 */

import { describe, it, expect } from "vitest";
import {
  BufferGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
} from "three";
import { collectAssetMetadata } from "../metadata";
import type { SelectedFile } from "../../lib/files";

const fakeFile: SelectedFile = {
  path: "/tmp/fake.dae",
  fileName: "fake.dae",
  extension: "dae",
  kind: "model",
  parentDirectory: "/tmp",
};

describe("collectAssetMetadata", () => {
  it("does not throw when an Object3D has a null name (Collada parity)", () => {
    const root = new Group();
    // Simulate ColladaLoader assigning null instead of "" — this is what
    // actually broke the DAE preview pipeline in the wild.
    (root as unknown as { name: unknown }).name = null;

    const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    mesh.name = "tetra";
    root.add(mesh);

    expect(() => collectAssetMetadata(root, fakeFile, [], null)).not.toThrow();
  });

  it("emits empty string for null-named nodes (HierarchyCard substitutes the (unnamed) display label)", () => {
    // Storing the placeholder string in the data layer would leak it
    // into USD prim path construction (#28) and trigger Ill-formed
    // SdfPath warnings. The display layer adds the "(unnamed)" label
    // purely for the visible row.
    const root = new Group();
    (root as unknown as { name: unknown }).name = null;

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.hierarchy[0]?.name).toBe("");
  });

  it("preserves real names when present", () => {
    const root = new Group();
    root.name = "MyRoot";
    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.hierarchy[0]?.name).toBe("MyRoot");
  });

  it("enumerates Three.js Light children as USD light entries (#35)", () => {
    const root = new Group();
    const sun = new DirectionalLight(0xfff5cc, 2.5);
    sun.name = "Sun";
    const fill = new PointLight(0x88aaff, 1.25);
    fill.name = "Fill";
    root.add(sun);
    root.add(fill);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.lights).toHaveLength(2);
    const [sunEntry, fillEntry] = result.metadata.lights;
    expect(sunEntry.name).toBe("Sun");
    expect(sunEntry.type).toBe("DirectionalLight");
    expect(sunEntry.intensity).toBe(2.5);
    expect(sunEntry.color).toBe("#fff5cc");
    expect(fillEntry.type).toBe("PointLight");

    // Lights must not be miscounted as meshes in nodeCount-derived budgets.
    expect(result.metadata.meshCount).toBe(0);
  });

  it("tolerates null name on light / camera (Collada parity)", () => {
    const root = new Group();
    const light = new DirectionalLight(0xffffff, 1);
    (light as unknown as { name: unknown }).name = null;
    const cam = new PerspectiveCamera();
    (cam as unknown as { name: unknown }).name = null;
    root.add(light);
    root.add(cam);

    expect(() => collectAssetMetadata(root, fakeFile, [], null)).not.toThrow();

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.lights[0]?.name).toBe("DirectionalLight");
    expect(result.metadata.cameras[0]?.name).toBe("PerspectiveCamera");
  });

  it("enumerates camera children with projection metadata (#34)", () => {
    const root = new Group();
    const cam = new PerspectiveCamera(40, 1.5, 0.01, 5000);
    cam.name = "Hero";
    root.add(cam);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.cameras).toHaveLength(1);
    const [camEntry] = result.metadata.cameras;
    expect(camEntry.name).toBe("Hero");
    expect(camEntry.projection).toBe("perspective");
    expect(camEntry.fov).toBe(40);
    expect(camEntry.aspect).toBe(1.5);
    expect(camEntry.near).toBe(0.01);
    expect(camEntry.far).toBe(5000);
  });

  it("records mesh bindings on each material entry (#36)", () => {
    const root = new Group();
    const sharedMat = new MeshBasicMaterial();
    sharedMat.name = "Body";
    const trim = new MeshBasicMaterial();
    trim.name = "Trim";

    const torso = new Mesh(new BufferGeometry(), sharedMat);
    torso.name = "Torso";
    const arm = new Mesh(new BufferGeometry(), sharedMat);
    arm.name = "Arm";
    const collar = new Mesh(new BufferGeometry(), trim);
    collar.name = "Collar";
    root.add(torso);
    root.add(arm);
    root.add(collar);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    const body = result.metadata.materials.find((m) => m.name === "Body");
    const trimEntry = result.metadata.materials.find((m) => m.name === "Trim");
    expect(body?.boundMeshes).toEqual(["Torso", "Arm"]);
    expect(trimEntry?.boundMeshes).toEqual(["Collar"]);
  });

  it("uses (unnamed mesh) for binding entries without a name", () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    mat.name = "M";
    const mesh = new Mesh(new BufferGeometry(), mat);
    (mesh as unknown as { name: unknown }).name = null;
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.materials[0].boundMeshes).toEqual([
      "(unnamed mesh)",
    ]);
  });

  it("strips USD-backend wrapper-node suffixes from fixture names", () => {
    // The Rust USD→GLB backend wraps lights/cameras in host nodes named
    // `<authored>_light_node` / `<authored>_camera_node`. GLTFLoader copies
    // those node names onto the fixture instances, so the inspector must
    // peel the suffix off to surface the authored USD prim name.
    const root = new Group();
    const light = new DirectionalLight(0xffffff, 1);
    light.name = "Key_light_node";
    const cam = new PerspectiveCamera();
    cam.name = "Hero_camera_node";
    root.add(light);
    root.add(cam);

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.lights[0]?.name).toBe("Key");
    expect(result.metadata.cameras[0]?.name).toBe("Hero");
  });
});
