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
import { Group, Mesh, BufferGeometry, MeshBasicMaterial } from "three";
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

    expect(() =>
      collectAssetMetadata(root, fakeFile, [], null),
    ).not.toThrow();
  });

  it("renders null-named nodes as (unnamed) in the hierarchy", () => {
    const root = new Group();
    (root as unknown as { name: unknown }).name = null;

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.hierarchy[0]?.name).toBe("(unnamed)");
  });

  it("preserves real names when present", () => {
    const root = new Group();
    root.name = "MyRoot";
    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.hierarchy[0]?.name).toBe("MyRoot");
  });
});
