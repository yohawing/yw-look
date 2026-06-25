import { Box3, MathUtils, MOUSE, Object3D, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ViewerSurfaceMode } from "../types/viewer";
import {
  applyControlsSensitivity,
  applyInitialView,
  applyTextureView,
  type SceneContext,
} from "../viewer";

export const INITIAL_GRID_NAME = "__yw_initial_grid";
export const AXES_HELPER_NAME = "__yw_axes_helper";

export function configureAssetControls(controls: OrbitControls) {
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.mouseButtons.LEFT = MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.DOLLY;
}

export function applyControlSensitivity(
  controls: OrbitControls,
  sensitivity: number,
) {
  // Clamp so users can't lock themselves out with a zero multiplier.
  const safe = Math.max(sensitivity, 0.05);
  controls.rotateSpeed = safe;
  controls.panSpeed = safe;
  controls.zoomSpeed = safe;
}

export function configureTextureControls(controls: OrbitControls) {
  controls.enableRotate = false;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.mouseButtons.LEFT = MOUSE.PAN;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.DOLLY;
}

export function syncGridVisibility(
  context: SceneContext,
  showGrid: boolean,
  viewerSurfaceMode: ViewerSurfaceMode,
  forceAssetGrid = false,
) {
  const grid = context.scene.getObjectByName(INITIAL_GRID_NAME);

  if (grid) {
    grid.visible =
      showGrid && (forceAssetGrid || viewerSurfaceMode === "asset");
  }
}

export function syncAxesVisibility(
  context: SceneContext,
  showAxes: boolean,
  viewerSurfaceMode: ViewerSurfaceMode,
  forceAssetAxes = false,
) {
  const axes = context.scene.getObjectByName(AXES_HELPER_NAME);

  if (axes) {
    axes.visible =
      showAxes && (forceAssetAxes || viewerSurfaceMode === "asset");
  }
}

export function frameMountedObject(
  context: SceneContext,
  object: NonNullable<SceneContext["mountedObject"]>,
  viewerSurfaceMode: ViewerSurfaceMode,
  showGrid: boolean,
  showAxes: boolean,
  sensitivityMultiplier = 1,
  rawMaxDimension?: number,
  texturePreview3D = false,
) {
  syncGridVisibility(context, showGrid, viewerSurfaceMode);
  syncAxesVisibility(context, showAxes, viewerSurfaceMode);

  if (viewerSurfaceMode === "texture" && !texturePreview3D) {
    configureTextureControls(context.controls);
    applyTextureView(context.camera, context.controls, object);
    // Use neutral (dim=1) sensitivity for texture pan/zoom so the hidden
    // asset's original size does not bleed into texture controls, but still
    // honour the user's manual camera-speed multiplier.
    applyControlsSensitivity(context.controls, 1, sensitivityMultiplier);
    context.controls.enabled = true;
    return;
  }

  configureAssetControls(context.controls);
  applyInitialView(
    context.camera,
    context.controls,
    object,
    sensitivityMultiplier,
    rawMaxDimension,
  );
  context.controls.enabled = true;
}

export function frameObjectBounds(
  context: SceneContext,
  object: Object3D,
  sensitivityMultiplier = 1,
) {
  const bounds = new Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const fitHeightDistance =
    maxDimension / (2 * Math.tan(MathUtils.degToRad(context.camera.fov * 0.5)));
  const fitDistance = fitHeightDistance * 1.5;
  const direction = context.camera.position
    .clone()
    .sub(context.controls.target)
    .normalize();
  if (direction.lengthSq() === 0) {
    direction.set(1.15, 0.8, 1.15).normalize();
  }

  context.camera.position.copy(
    center.clone().add(direction.multiplyScalar(fitDistance)),
  );
  context.camera.near = Math.max(maxDimension / 500, 0.01);
  context.camera.far = Math.max(maxDimension * 20, 200);
  context.camera.lookAt(center);
  context.camera.updateProjectionMatrix();

  context.controls.target.copy(center);
  context.controls.minDistance = Math.max(maxDimension / 50, 0.05);
  context.controls.maxDistance = Math.max(maxDimension * 40, 50);
  applyControlsSensitivity(
    context.controls,
    maxDimension,
    sensitivityMultiplier,
  );
  context.controls.update();
  context.controls.enabled = true;
}
