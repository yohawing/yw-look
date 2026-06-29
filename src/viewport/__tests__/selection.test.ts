import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from "three";
import { createViewportPicker } from "../selection";

function makeDomElement() {
  return {
    getBoundingClientRect: () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      }) as DOMRect,
  };
}

function makePointer(clientX: number, clientY: number) {
  return { clientX, clientY } as PointerEvent;
}

describe("createViewportPicker", () => {
  it("returns the selection key for a mesh under the pointer", () => {
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "Cube";
    mesh.position.z = -5;
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement());

    expect(picker.pickSelectionKey(scene, makePointer(50, 50))).toBe("Cube");
  });

  it("selects a mounted root mesh directly", () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "RootMesh";
    mesh.position.z = -5;
    mesh.updateMatrixWorld(true);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement());

    expect(picker.pickSelectionKey(mesh, makePointer(50, 50))).toBe("RootMesh");
  });

  it("ignores the shadow catcher mesh", () => {
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "__yw_shadow_catcher";
    mesh.position.z = -5;
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement());

    expect(picker.pickSelectionKey(scene, makePointer(50, 50))).toBeNull();
  });

  it("returns null when the pointer misses selectable geometry", () => {
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "Cube";
    mesh.position.set(10, 10, -5);
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement());

    expect(picker.pickSelectionKey(scene, makePointer(50, 50))).toBeNull();
  });
});
