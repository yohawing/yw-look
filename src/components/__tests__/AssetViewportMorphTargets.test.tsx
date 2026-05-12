import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three";
import { applyMorphTargetValues } from "../morphTargets";

function makeMorphMesh(name: string): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  const target = new Float32BufferAttribute(
    [0, 0.1, 0, 1, 0.1, 0, 0, 1.1, 0],
    3,
  );
  target.name = "blink_L";
  geometry.morphAttributes.position = [target];

  const mesh = new Mesh(geometry);
  mesh.name = name;
  mesh.updateMorphTargets();
  return mesh;
}

describe("applyMorphTargetValues", () => {
  it("applies morph values by object name", () => {
    const root = new Group();
    const mesh = makeMorphMesh("Face");
    root.add(mesh);

    applyMorphTargetValues(root, { Face: { 0: 0.4 } });

    expect(mesh.morphTargetInfluences?.[0]).toBe(0.4);
  });

  it("prefers primPath for USD-sourced meshes", () => {
    const root = new Group();
    const mesh = makeMorphMesh("Face");
    mesh.userData.primPath = "/World/Face";
    root.add(mesh);

    applyMorphTargetValues(root, {
      Face: { 0: 0.1 },
      "/World/Face": { 0: 0.7 },
    });

    expect(mesh.morphTargetInfluences?.[0]).toBe(0.7);
  });
});
