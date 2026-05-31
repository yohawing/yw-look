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

function fitDistance(camera: PerspectiveCamera, maxDimension: number) {
  return (
    (maxDimension / (2 * Math.tan((camera.fov * Math.PI) / 180 / 2))) * 1.5
  );
}

function makeSplatObject(target: Vector3, maxDimension: number) {
  const object = new Group();
  object.userData.disableAutoFrame = true;
  object.userData.disableAutoFrameTarget = target;
  object.userData.disableAutoFrameMaxDimension = maxDimension;
  return object;
}

describe("scene splat framing", () => {
  it("uses Spark-derived splat dimensions for the initial home distance", () => {
    const camera = new PerspectiveCamera(50, 1, 0.01, 1000);
    const controls = makeControls();
    const target = new Vector3(-11.7, 0, 0);
    const object = makeSplatObject(target, 540);

    applyInitialView(camera, controls, object);

    expect(controls.target.toArray()).toEqual(target.toArray());
    expect(camera.position.distanceTo(target)).toBeCloseTo(
      fitDistance(camera, 540),
      5,
    );
    expect(controls.update).toHaveBeenCalledOnce();
  });

  it("uses Spark-derived splat dimensions for preset camera distances", () => {
    const camera = new PerspectiveCamera(50, 1, 0.01, 1000);
    const controls = makeControls();
    const target = new Vector3(0, 0.85, 1.34);
    const object = makeSplatObject(target, 400);

    applyPresetView(camera, controls, object, "front");

    expect(controls.target.toArray()).toEqual(target.toArray());
    expect(camera.position.x).toBeCloseTo(target.x, 5);
    expect(camera.position.y).toBeCloseTo(target.y, 5);
    expect(camera.position.z - target.z).toBeCloseTo(
      fitDistance(camera, 400),
      5,
    );
  });

  it("reports Spark-derived dimensions when Box3 cannot measure the splat mesh", () => {
    const object = makeSplatObject(new Vector3(), 480);

    expect(getObjectMaxDimension(object)).toBe(480);
  });
});
