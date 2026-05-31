import { describe, expect, it, vi } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  applyInitialView,
  applyPresetView,
  getObjectMaxDimension,
} from "../scene";

function makeControls() {
  return {
    target: new Vector3(),
    update: vi.fn(),
    minDistance: 0,
    maxDistance: 0,
    rotateSpeed: 0,
    panSpeed: 0,
    zoomSpeed: 0,
  } as unknown as OrbitControls;
}

function makeSplatObject() {
  const object = new Group();
  object.userData.disableAutoFrame = true;
  return object;
}

describe("scene splat framing", () => {
  it("keeps splat initial view at the default origin-facing camera pose", () => {
    const camera = new PerspectiveCamera(50, 1, 0.01, 1000);
    const controls = makeControls();
    const object = makeSplatObject();

    applyInitialView(camera, controls, object);

    expect(camera.position.toArray()).toEqual([5, 4, 5]);
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
    expect(camera.near).toBe(0.01);
    expect(camera.far).toBe(100_000);
    expect(controls.update).toHaveBeenCalledOnce();
  });

  it("keeps splat preset views centered on the authored origin", () => {
    const camera = new PerspectiveCamera(50, 1, 0.01, 1000);
    const controls = makeControls();
    const object = makeSplatObject();

    applyPresetView(camera, controls, object, "front");

    expect(controls.target.toArray()).toEqual([0, 0, 0]);
    expect(camera.position.x).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeCloseTo(0, 5);
    expect(camera.position.z).toBeCloseTo(new Vector3(5, 4, 5).length(), 5);
  });

  it("uses the default scene dimension when Box3 cannot measure the splat mesh", () => {
    const object = makeSplatObject();

    expect(getObjectMaxDimension(object)).toBe(1);
  });
});
