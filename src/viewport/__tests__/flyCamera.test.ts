import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createFlyCameraControls } from "../flyCamera";

function makeControls(camera: PerspectiveCamera) {
  return {
    enabled: true,
    target: new Vector3(0, 0, -5),
    object: camera,
  } as unknown as OrbitControls;
}

function movementEvent(delta: { movementX?: number; movementY?: number }) {
  const event = new MouseEvent("mousemove");
  Object.defineProperty(event, "movementX", { value: delta.movementX ?? 0 });
  Object.defineProperty(event, "movementY", { value: delta.movementY ?? 0 });
  return event;
}

function setPointerLockElement(element: Element | null) {
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    value: element,
  });
}

describe("createFlyCameraControls", () => {
  afterEach(() => {
    setPointerLockElement(null);
    vi.restoreAllMocks();
  });

  it("does not enter fly mode while an authored camera is active", () => {
    const camera = new PerspectiveCamera();
    const controls = makeControls(camera);
    const domElement = document.createElement("canvas");
    const requestPointerLock = vi.fn();
    domElement.requestPointerLock = requestPointerLock;

    const fly = createFlyCameraControls({
      camera,
      controls,
      domElement,
      hasActiveCamera: () => true,
      hasMountedObject: () => true,
    });

    fly.enter();

    expect(fly.isActive()).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it("integrates held-key fly movement and restores orbit controls on exit", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const camera = new PerspectiveCamera();
    const controls = makeControls(camera);
    const domElement = document.createElement("canvas");
    domElement.requestPointerLock = vi.fn();

    const fly = createFlyCameraControls({
      camera,
      controls,
      domElement,
      hasActiveCamera: () => false,
      hasMountedObject: () => true,
    });

    fly.enter();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(fly.update(1000)).toBe(true);

    expect(camera.position.z).toBeCloseTo(-0.5);
    expect(controls.enabled).toBe(false);

    fly.exit();

    expect(fly.isActive()).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(controls.target.distanceTo(camera.position)).toBeGreaterThan(0);
  });

  it("updates camera orientation from pointer movement while active", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const camera = new PerspectiveCamera();
    const controls = makeControls(camera);
    const domElement = document.createElement("canvas");
    domElement.requestPointerLock = vi.fn();

    const fly = createFlyCameraControls({
      camera,
      controls,
      domElement,
      hasActiveCamera: () => false,
      hasMountedObject: () => true,
    });
    const initialQuaternion = camera.quaternion.clone();

    fly.enter();
    window.dispatchEvent(movementEvent({ movementX: 20, movementY: -10 }));

    expect(camera.quaternion.equals(initialQuaternion)).toBe(false);
    fly.exit();
  });

  it("exits when pointer lock is externally released", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const camera = new PerspectiveCamera();
    const controls = makeControls(camera);
    const domElement = document.createElement("canvas");
    domElement.requestPointerLock = vi.fn();

    const fly = createFlyCameraControls({
      camera,
      controls,
      domElement,
      hasActiveCamera: () => false,
      hasMountedObject: () => true,
    });

    fly.enter();
    expect(fly.isActive()).toBe(true);

    setPointerLockElement(null);
    fly.handlePointerLockChange();

    expect(fly.isActive()).toBe(false);
    expect(controls.enabled).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(fly.update(1000)).toBe(false);
    expect(camera.position.length()).toBe(0);
  });

  it("applies wheel speed changes and prevents page scrolling while active", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const camera = new PerspectiveCamera();
    const controls = makeControls(camera);
    const domElement = document.createElement("canvas");
    domElement.requestPointerLock = vi.fn();

    const fly = createFlyCameraControls({
      camera,
      controls,
      domElement,
      hasActiveCamera: () => false,
      hasMountedObject: () => true,
    });

    fly.enter();
    const wheel = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    domElement.dispatchEvent(wheel);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    fly.update(1000);

    expect(wheel.defaultPrevented).toBe(true);
    expect(camera.position.z).toBeCloseTo(-0.55);
    fly.exit();
  });

  it("recomputes movement when opposing keys overlap and one is released", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const camera = new PerspectiveCamera();
    const controls = makeControls(camera);
    const domElement = document.createElement("canvas");
    domElement.requestPointerLock = vi.fn();

    const fly = createFlyCameraControls({
      camera,
      controls,
      domElement,
      hasActiveCamera: () => false,
      hasMountedObject: () => true,
    });

    fly.enter();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS" }));
    fly.update(1000);
    expect(camera.position.z).toBeCloseTo(0);

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyS" }));
    fly.update(1100);
    expect(camera.position.z).toBeCloseTo(-0.5);
    fly.exit();
  });
});
