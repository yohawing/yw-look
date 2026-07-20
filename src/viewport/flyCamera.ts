import { Euler, MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type FlyCameraControls = {
  enter(): void;
  exit(): void;
  handlePointerLockChange(): void;
  isActive(): boolean;
  update(frameNow: number): boolean;
};

export function createFlyCameraControls({
  camera,
  controls,
  domElement,
  hasActiveCamera,
  hasMountedObject,
}: {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  domElement: HTMLElement;
  hasActiveCamera: () => boolean;
  hasMountedObject: () => boolean;
}): FlyCameraControls {
  const state = {
    active: false,
    lastFrameTime: 0,
    input: new Vector3(0, 0, 0),
    speed: 5,
    euler: new Euler(0, 0, 0, "YXZ"),
    orbitRadius: 5,
  };
  const minSpeed = 0.1;
  const maxSpeed = 200;
  const pitchLimit = MathUtils.degToRad(89);
  const forward = new Vector3();
  const right = new Vector3();
  const heldKeys = new Set<string>();
  const flyKeys = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE"]);

  const restoreOrbitTargetFromCamera = () => {
    forward.set(0, 0, -1).applyEuler(state.euler);
    const distance = MathUtils.clamp(state.orbitRadius, 1, 50);
    controls.target.copy(camera.position).addScaledVector(forward, distance);
  };

  const recomputeInput = () => {
    let x = 0;
    let y = 0;
    let z = 0;
    if (heldKeys.has("KeyW")) z -= 1;
    if (heldKeys.has("KeyS")) z += 1;
    if (heldKeys.has("KeyA")) x -= 1;
    if (heldKeys.has("KeyD")) x += 1;
    if (heldKeys.has("KeyE")) y += 1;
    if (heldKeys.has("KeyQ")) y -= 1;
    state.input.set(x, y, z);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!state.active) return;
    const sensitivity = 0.002;
    state.euler.y -= event.movementX * sensitivity;
    state.euler.x -= event.movementY * sensitivity;
    state.euler.x = MathUtils.clamp(state.euler.x, -pitchLimit, pitchLimit);
    camera.quaternion.setFromEuler(state.euler);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!state.active) return;
    if (!flyKeys.has(event.code)) return;
    heldKeys.add(event.code);
    recomputeInput();
    event.preventDefault();
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (!flyKeys.has(event.code)) return;
    heldKeys.delete(event.code);
    recomputeInput();
  };

  const handleWheel = (event: WheelEvent) => {
    if (!state.active) return;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    state.speed = MathUtils.clamp(state.speed * factor, minSpeed, maxSpeed);
    event.preventDefault();
  };

  const enter = () => {
    if (hasActiveCamera()) return;
    if (state.active) return;
    state.active = true;
    heldKeys.clear();
    state.input.set(0, 0, 0);
    state.euler.setFromQuaternion(camera.quaternion, "YXZ");
    state.lastFrameTime = performance.now();
    state.orbitRadius = controls.target.distanceTo(camera.position);
    controls.enabled = false;
    domElement.requestPointerLock?.();
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    domElement.addEventListener("wheel", handleWheel, { passive: false });
  };

  const exit = () => {
    if (!state.active) return;
    state.active = false;
    heldKeys.clear();
    state.input.set(0, 0, 0);
    if (document.pointerLockElement === domElement) {
      document.exitPointerLock?.();
    }
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    domElement.removeEventListener("wheel", handleWheel);
    restoreOrbitTargetFromCamera();
    controls.enabled = hasMountedObject();
  };

  return {
    enter,
    exit,
    handlePointerLockChange() {
      const locked = document.pointerLockElement === domElement;
      if (locked && !state.active) {
        document.exitPointerLock?.();
      } else if (!locked && state.active) {
        exit();
      }
    },
    isActive() {
      return state.active;
    },
    update(frameNow) {
      if (!state.active) {
        return false;
      }

      const dt = Math.min(0.1, (frameNow - state.lastFrameTime) / 1000);
      state.lastFrameTime = frameNow;
      const input = state.input;
      if (dt > 0 && (input.x !== 0 || input.y !== 0 || input.z !== 0)) {
        forward.set(0, 0, -1).applyEuler(state.euler);
        right.set(1, 0, 0).applyEuler(state.euler);
        const distance = state.speed * dt;
        camera.position
          .addScaledVector(forward, -input.z * distance)
          .addScaledVector(right, input.x * distance);
        camera.position.y += input.y * distance;
      }
      return true;
    },
  };
}
