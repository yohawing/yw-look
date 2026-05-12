import {
  AxesHelper,
  Box3,
  Box3Helper,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  GridHelper,
  Group,
  LinearFilter,
  LinearMipMapLinearFilter,
  type MagnificationTextureFilter,
  Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type MinificationTextureFilter,
  NearestFilter,
  NearestMipMapNearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SkeletonHelper,
  SkinnedMesh,
  Texture,
  Vector3,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VertexNormalsHelper } from "three/examples/jsm/helpers/VertexNormalsHelper.js";
import type { DisplayMode, SceneContext } from "./types";

export const GRID_NAME = "__yw_initial_grid";
export const AXES_NAME = "__yw_axes_helper";
export const SHADOW_CATCHER_NAME = "__yw_shadow_catcher";
const SKELETON_HELPER_FLAG = "__yw_skeleton_helper";
const BBOX_HELPER_FLAG = "__yw_bbox_helper";
const NORMAL_HELPER_FLAG = "__yw_normal_helper";
const GRID_DIVISIONS = 20;
// Axes length is tied to grid size so the XYZ indicator scales with the
// current unit preset. Slightly longer than half a grid cell keeps the
// arrows visible but avoids punching through a model that fills the grid.
const AXES_LENGTH_FACTOR = 0.6;
const MIN_NORMALIZED_DIMENSION = 0.1;
const MAX_NORMALIZED_DIMENSION = 100;
const SCALE_EPSILON = 1e-8;
export const DEFAULT_SCENE_DIMENSION = 1;

type GridPreset = {
  maxDimension: number;
  cellSize: number;
  label: string;
};

export type GridConfig = {
  cellSize: number;
  label: string;
  size: number;
  divisions: number;
};

export type ScaleNormalizationResult = {
  applied: boolean;
  factor: number;
  originalMaxDimension: number;
  normalizedMaxDimension: number;
  originalScale: Vector3 | null;
};

// Grid density presets tuned for inspection workflows:
// small assets use finer mm/cm cells, large assets use coarser m-based cells.
const gridPresets: GridPreset[] = [
  { maxDimension: 0.1, cellSize: 0.001, label: "1 mm" },
  { maxDimension: 1, cellSize: 0.01, label: "1 cm" },
  { maxDimension: 10, cellSize: 0.1, label: "10 cm" },
  { maxDimension: 100, cellSize: 1, label: "1 m" },
  { maxDimension: 1000, cellSize: 10, label: "10 m" },
  { maxDimension: Number.POSITIVE_INFINITY, cellSize: 100, label: "100 m" },
];

export function getMaterials(material: Material | Material[]) {
  return Array.isArray(material) ? material : [material];
}

function disposeMaterialTextures(material: Material) {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) {
      value.dispose();
    }
  }
}

export function revokeUrls(urls: string[]) {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}

export function disposeObject(object: Group | Mesh | null) {
  if (!object) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      child.geometry.dispose();
    }

    if (child instanceof Mesh) {
      for (const material of getMaterials(child.material)) {
        if (!material) {
          continue;
        }

        disposeMaterialTextures(material);
        material.dispose();
      }
    }
  });
}

export function disposePreviewObject(object: Group | Mesh | null) {
  if (!object) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      child.geometry.dispose();
    }

    if (child instanceof Mesh) {
      for (const material of getMaterials(child.material)) {
        material.dispose();
      }
    }
  });
}

export function stopAnimations(context: SceneContext) {
  context.activeAction?.stop();
  context.mixer?.stopAllAction();
  context.activeAction = null;
  context.mixer = null;
  context.clips = [];
}

export function resetSceneObjects(context: SceneContext) {
  // Drop any overlay helpers pointing at the outgoing asset before
  // we dispose its geometry, otherwise the helpers would still
  // reference freed buffers until the next toggle.
  removeSkeletonHelpers(context.scene);
  removeBoundingBoxHelpers(context.scene);
  removeNormalHelpers(context.scene);

  if (context.previewObject) {
    context.scene.remove(context.previewObject);
    disposePreviewObject(context.previewObject);
    context.previewObject = null;
  }

  if (context.sourceObject) {
    context.scene.remove(context.sourceObject);
    disposeObject(context.sourceObject);
    context.sourceObject = null;
  }

  context.mountedObject = null;
  context.textureRegistry = new Map<string, Texture>();
}

/**
 * Compute auto sensitivity speeds for OrbitControls based on model size.
 *
 * Strategy: use a log10-based mapping so that sensitivity grows smoothly
 * across the mm→km range without breaking at extreme values.
 *
 *   log10(0.001) = -3  → very small (mm scale) → slower rotate, slower pan
 *   log10(1)     =  0  → reference (1 m scale) → baseline speeds
 *   log10(1000)  =  3  → large (km scale)      → faster pan, same rotate
 *
 * Rotate speed: kept close to 1 for all sizes – perceived rotation is
 * already independent of model scale. Slight reduction for tiny models
 * helps precision work.
 *
 * Pan speed: scales up with larger models so a single gesture covers a
 * meaningful distance. Clamped to [0.3, 3.0].
 *
 * Zoom speed (scroll): similarly scaled. Clamped to [0.5, 2.5].
 */
export function computeAutoSensitivity(maxDimension: number): {
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
} {
  const safeDim =
    Number.isFinite(maxDimension) && maxDimension > 0 ? maxDimension : 1;
  // log10 of maxDimension, clamped to [-3, 3]
  const logDim = Math.max(-3, Math.min(3, Math.log10(safeDim)));
  // Normalise to [0, 1] where 0 = 0.001 m, 1 = 1000 m
  const t = (logDim + 3) / 6;

  const rotateSpeed = MathUtils.lerp(0.6, 1.0, t);
  const panSpeed = MathUtils.lerp(0.3, 3.0, t);
  const zoomSpeed = MathUtils.lerp(0.5, 2.5, t);

  return { rotateSpeed, panSpeed, zoomSpeed };
}

export function applyControlsSensitivity(
  controls: OrbitControls,
  maxDimension: number,
  multiplier: number,
) {
  const safeMultiplier =
    Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const auto = computeAutoSensitivity(maxDimension);
  controls.rotateSpeed = auto.rotateSpeed * safeMultiplier;
  controls.panSpeed = auto.panSpeed * safeMultiplier;
  controls.zoomSpeed = auto.zoomSpeed * safeMultiplier;
}

export function applyInitialView(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  object: Group | Mesh,
  sensitivityMultiplier = 1,
  /**
   * Original (pre-normalization) max dimension of the asset in scene units.
   * Used for camera sensitivity only – camera position and clipping planes
   * are computed from the normalized `object` bounds as usual.
   * When omitted, sensitivity falls back to the normalized dimension.
   */
  rawMaxDimension?: number,
) {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const fitHeightDistance =
    maxDimension / (2 * Math.tan(MathUtils.degToRad(camera.fov * 0.5)));
  const fitDistance = fitHeightDistance * 1.5;
  const offset = new Vector3(1.15, 0.8, 1.15)
    .normalize()
    .multiplyScalar(fitDistance);

  camera.position.copy(center.clone().add(offset));
  camera.near = Math.max(maxDimension / 500, 0.01);
  camera.far = Math.max(maxDimension * 20, 200);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(maxDimension / 50, 0.05);
  controls.maxDistance = Math.max(maxDimension * 40, 50);
  // Use the raw (pre-normalization) dimension for sensitivity so that a 1 mm
  // asset gets finer controls than a 10 m asset even after normalization.
  const sensitivityDim =
    rawMaxDimension !== undefined && rawMaxDimension > 0
      ? rawMaxDimension
      : maxDimension;
  applyControlsSensitivity(controls, sensitivityDim, sensitivityMultiplier);
  controls.update();
}

export type CameraPreset =
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom";

// Direction vectors are where the camera sits relative to the target.
// `front` means "the viewer is in front of the model and looks back along -Z".
const cameraPresetDirections: Record<CameraPreset, Vector3> = {
  front: new Vector3(0, 0, 1),
  back: new Vector3(0, 0, -1),
  left: new Vector3(-1, 0, 0),
  right: new Vector3(1, 0, 0),
  top: new Vector3(0, 1, 0),
  bottom: new Vector3(0, -1, 0),
};

// For the top/bottom views the default Y-up reference collapses (lookAt
// degenerates). Pick an arbitrary but stable in-plane up vector so
// OrbitControls.update() has something to orient against.
const cameraPresetUpOverrides: Partial<Record<CameraPreset, Vector3>> = {
  top: new Vector3(0, 0, -1),
  bottom: new Vector3(0, 0, 1),
};

export function applyPresetView(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  object: Group | Mesh,
  preset: CameraPreset,
) {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const fitHeightDistance =
    maxDimension / (2 * Math.tan(MathUtils.degToRad(camera.fov * 0.5)));
  const fitDistance = fitHeightDistance * 1.5;

  const direction = cameraPresetDirections[preset].clone().normalize();
  const offset = direction.multiplyScalar(fitDistance);
  camera.position.copy(center.clone().add(offset));

  const upOverride = cameraPresetUpOverrides[preset];
  camera.up.copy(upOverride ?? new Vector3(0, 1, 0));

  camera.near = Math.max(maxDimension / 500, 0.01);
  camera.far = Math.max(maxDimension * 20, 200);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(maxDimension / 50, 0.05);
  controls.maxDistance = Math.max(maxDimension * 40, 50);
  controls.update();
}

export function applyTextureView(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  object: Group | Mesh,
) {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const safeWidth = Math.max(size.x, 0.001);
  const safeHeight = Math.max(size.y, 0.001);
  const verticalFov = MathUtils.degToRad(camera.fov);
  const horizontalFov =
    2 * Math.atan(Math.tan(verticalFov * 0.5) * camera.aspect);
  const fitHeightDistance = safeHeight / (2 * Math.tan(verticalFov * 0.5));
  const fitWidthDistance = safeWidth / (2 * Math.tan(horizontalFov * 0.5));
  const fitDistance = Math.max(fitHeightDistance, fitWidthDistance) * 1.08;

  camera.position.set(center.x, center.y, center.z + fitDistance);
  camera.near = Math.max(fitDistance / 100, 0.01);
  camera.far = Math.max(fitDistance * 20, 20);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(fitDistance / 4, 0.05);
  controls.maxDistance = Math.max(fitDistance * 20, 20);
  controls.update();
}

export function getObjectMaxDimension(object: Group | Mesh) {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  return Math.max(size.x, size.y, size.z);
}

export function normalizeObjectScale(
  object: Group | Mesh,
): ScaleNormalizationResult {
  const originalMaxDimension = getObjectMaxDimension(object);
  if (!Number.isFinite(originalMaxDimension) || originalMaxDimension <= 0) {
    return {
      applied: false,
      factor: 1,
      originalMaxDimension: 0,
      normalizedMaxDimension: 0,
      originalScale: null,
    };
  }

  // Only normalize when the object is outside the acceptable viewing range.
  if (
    originalMaxDimension >= MIN_NORMALIZED_DIMENSION &&
    originalMaxDimension <= MAX_NORMALIZED_DIMENSION
  ) {
    return {
      applied: false,
      factor: 1,
      originalMaxDimension,
      normalizedMaxDimension: originalMaxDimension,
      originalScale: null,
    };
  }

  // Pick a power-of-10 scale factor that brings the object into
  // [MIN, MAX].  This way the factor itself is always 10ⁿ, making
  // it immediately obvious how much the scale was adjusted.
  let factor = 1;
  if (originalMaxDimension < MIN_NORMALIZED_DIMENSION) {
    const targetPower = Math.ceil(
      Math.log10(MIN_NORMALIZED_DIMENSION / originalMaxDimension),
    );
    factor = Math.pow(10, targetPower);
  } else {
    const targetPower = Math.floor(
      Math.log10(MAX_NORMALIZED_DIMENSION / originalMaxDimension),
    );
    factor = Math.pow(10, targetPower);
  }

  const applied = Math.abs(factor - 1) > SCALE_EPSILON;

  const originalScale = applied ? object.scale.clone() : null;

  if (applied) {
    object.scale.multiplyScalar(factor);
    object.updateMatrixWorld(true);
  }

  return {
    applied,
    factor,
    originalMaxDimension,
    normalizedMaxDimension: applied
      ? getObjectMaxDimension(object)
      : originalMaxDimension,
    originalScale,
  };
}

export function cancelScaleNormalization(
  object: Group | Mesh,
  originalScale: Vector3,
): void {
  object.scale.copy(originalScale);
  object.updateMatrixWorld(true);
}

export function getGridConfig(maxDimension: number): GridConfig {
  const targetMaxDimension =
    Number.isFinite(maxDimension) && maxDimension > 0
      ? maxDimension
      : DEFAULT_SCENE_DIMENSION;
  const preset =
    gridPresets.find(
      (candidate) => targetMaxDimension <= candidate.maxDimension,
    ) ?? gridPresets.at(-1)!;

  return {
    cellSize: preset.cellSize,
    label: preset.label,
    size: preset.cellSize * GRID_DIVISIONS,
    divisions: GRID_DIVISIONS,
  };
}

function disposeGrid(grid: GridHelper) {
  grid.geometry.dispose();
  for (const material of getMaterials(grid.material)) {
    material.dispose();
  }
}

export function applyDynamicGrid(
  scene: Scene,
  maxDimension: number,
  visible: boolean,
) {
  const existingGrid = scene.getObjectByName(GRID_NAME);
  if (existingGrid instanceof GridHelper) {
    scene.remove(existingGrid);
    disposeGrid(existingGrid);
  }

  const config = getGridConfig(maxDimension);
  const grid = new GridHelper(
    config.size,
    config.divisions,
    "#555b66",
    "#3a3f48",
  );
  grid.name = GRID_NAME;
  grid.visible = visible;
  scene.add(grid);

  return config;
}

function disposeAxes(axes: AxesHelper) {
  axes.geometry.dispose();
  for (const material of getMaterials(axes.material)) {
    material.dispose();
  }
}

export function applyDynamicAxes(
  scene: Scene,
  maxDimension: number,
  visible: boolean,
) {
  const existing = scene.getObjectByName(AXES_NAME);
  if (existing instanceof AxesHelper) {
    scene.remove(existing);
    disposeAxes(existing);
  }

  const config = getGridConfig(maxDimension);
  const axes = new AxesHelper(config.size * AXES_LENGTH_FACTOR);
  axes.name = AXES_NAME;
  axes.visible = visible;
  // Render axes on top of the grid but keep the default depth test so
  // they can still be occluded by solid geometry.
  axes.renderOrder = 1;
  scene.add(axes);

  return axes;
}

export function formatScaleFactor(factor: number) {
  if (!Number.isFinite(factor) || factor === 0) {
    return "0";
  }

  const log10 = Math.log10(Math.abs(factor));
  const isExactPower = Math.abs(log10 - Math.round(log10)) < 1e-9;
  if (isExactPower) {
    const exp = Math.round(log10);
    if (exp >= 0) return String(Math.pow(10, exp));
    return factor.toFixed(Math.abs(exp));
  }

  const magnitude = Math.abs(factor);
  if (magnitude < 0.0001 || magnitude >= 10000) {
    return factor.toExponential(4);
  }

  return factor.toPrecision(4);
}

export function getScaleWarning(
  object: Group | Mesh,
  normalized: ScaleNormalizationResult | null = null,
) {
  if (normalized?.applied) {
    return `Scale normalized (${formatScaleFactor(normalized.factor)}×). Click "Cancel Scale Normalize" to revert.`;
  }

  const maxDimension = getObjectMaxDimension(object);

  if (maxDimension <= 0.001) {
    return "Scale warning: the loaded content is extremely small.";
  }

  if (maxDimension >= 10000) {
    return "Scale warning: the loaded content is extremely large.";
  }

  return null;
}

// The shadow catcher is a ShadowMaterial plane that only renders
// where it receives shadow. We keep it hidden until the user opts in
// so a disabled shadow pipeline doesn't eat any GPU budget.
export function ensureShadowCatcher(scene: Scene) {
  const existing = scene.getObjectByName(SHADOW_CATCHER_NAME);
  if (existing instanceof Mesh) {
    return existing;
  }
  const plane = new Mesh(
    new PlaneGeometry(200, 200),
    new ShadowMaterial({ opacity: 0.35 }),
  );
  plane.name = SHADOW_CATCHER_NAME;
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  plane.visible = false;
  scene.add(plane);
  return plane;
}

function updateShadowCatcherForObject(scene: Scene, object: Group | Mesh) {
  const catcher = scene.getObjectByName(SHADOW_CATCHER_NAME);
  if (!(catcher instanceof Mesh)) {
    return;
  }
  const bounds = new Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    return;
  }
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  // Sit just below the model so the shadow doesn't z-fight with
  // whatever ground plane the model itself authored, and stretch
  // wide enough to catch long shadows at low sun angles.
  const padding = Math.max(size.x, size.z, 1) * 3;
  const geometry = catcher.geometry;
  if (geometry instanceof PlaneGeometry) {
    geometry.dispose();
  }
  (catcher as Mesh).geometry = new PlaneGeometry(padding, padding);
  catcher.position.set(center.x, bounds.min.y - size.y * 0.001, center.z);
}

export function applyShadows(
  scene: Scene,
  object: Group | Mesh | null,
  keyLight: DirectionalLight | null,
  enabled: boolean,
) {
  const catcher = scene.getObjectByName(SHADOW_CATCHER_NAME);
  if (catcher instanceof Mesh) {
    catcher.visible = enabled;
  }
  if (keyLight) {
    keyLight.castShadow = enabled;
  }
  if (!object) {
    return;
  }
  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) return;
    if (
      child.userData[SKELETON_HELPER_FLAG] === true ||
      child.userData[BBOX_HELPER_FLAG] === true ||
      child.userData[NORMAL_HELPER_FLAG] === true ||
      child.name === SHADOW_CATCHER_NAME
    ) {
      return;
    }
    child.castShadow = enabled;
    child.receiveShadow = enabled;
  });
  if (enabled && object) {
    updateShadowCatcherForObject(scene, object);
  }
}

function disposeSkeletonHelper(helper: SkeletonHelper) {
  helper.geometry.dispose();
  for (const material of getMaterials(helper.material)) {
    material.dispose();
  }
}

// Collect skeleton roots (rigs) once so we emit a single helper per
// skeleton even if the rig drives several SkinnedMesh children.
function collectSkeletonRoots(object: Group | Mesh): Object3D[] {
  const seen = new Set<Object3D>();
  const roots: Object3D[] = [];
  object.traverse((child: Object3D) => {
    if (!(child instanceof SkinnedMesh) || !child.skeleton) {
      return;
    }
    const firstBone = child.skeleton.bones[0];
    if (!firstBone) {
      return;
    }
    // Walk up to the highest bone so the helper draws the full chain.
    let root: Object3D = firstBone;
    while (root.parent && (root.parent as Object3D).type === "Bone") {
      root = root.parent as Object3D;
    }
    if (seen.has(root)) {
      return;
    }
    seen.add(root);
    roots.push(root);
  });
  return roots;
}

export function removeSkeletonHelpers(scene: Scene) {
  const toRemove: SkeletonHelper[] = [];
  scene.traverse((child: Object3D) => {
    if (
      child instanceof SkeletonHelper &&
      child.userData[SKELETON_HELPER_FLAG] === true
    ) {
      toRemove.push(child);
    }
  });
  for (const helper of toRemove) {
    helper.parent?.remove(helper);
    disposeSkeletonHelper(helper);
  }
}

// SkeletonHelper / Box3Helper / VertexNormalsHelper all compute line
// positions using the target mesh's matrixWorld. Adding them as a
// child of the mounted object would apply the parent's transform a
// second time, so all helpers live directly under the scene and we
// track them with userData flags for cleanup.
export function applySkeletonHelpers(
  scene: Scene,
  object: Group | Mesh,
  visible: boolean,
) {
  removeSkeletonHelpers(scene);
  if (!visible) {
    return;
  }

  const roots = collectSkeletonRoots(object);
  for (const root of roots) {
    const helper = new SkeletonHelper(root);
    helper.userData[SKELETON_HELPER_FLAG] = true;
    // Draw bones on top of the skinned mesh so the rig stays visible
    // through geometry without disabling depth entirely.
    helper.renderOrder = 2;
    const materials = getMaterials(helper.material);
    for (const material of materials) {
      if ("depthTest" in material) {
        material.depthTest = false;
      }
      if ("transparent" in material) {
        material.transparent = true;
      }
    }
    scene.add(helper);
  }
}

function disposeBoundingBoxHelper(helper: Box3Helper) {
  helper.geometry.dispose();
  for (const material of getMaterials(helper.material)) {
    material.dispose();
  }
}

export function removeBoundingBoxHelpers(scene: Scene) {
  const toRemove: Box3Helper[] = [];
  scene.traverse((child: Object3D) => {
    if (
      child instanceof Box3Helper &&
      child.userData[BBOX_HELPER_FLAG] === true
    ) {
      toRemove.push(child);
    }
  });
  for (const helper of toRemove) {
    helper.parent?.remove(helper);
    disposeBoundingBoxHelper(helper);
  }
}

export function applyBoundingBoxHelpers(
  scene: Scene,
  object: Group | Mesh,
  visible: boolean,
) {
  removeBoundingBoxHelpers(scene);
  if (!visible) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }
    // Ignore our own helper meshes — SkeletonHelper, AxesHelper and
    // Box3Helper all extend LineSegments which extends Mesh.
    if (
      child.userData[SKELETON_HELPER_FLAG] === true ||
      child.userData[BBOX_HELPER_FLAG] === true ||
      child.userData[NORMAL_HELPER_FLAG] === true
    ) {
      return;
    }

    const geometry = child.geometry;
    if (!(geometry instanceof BufferGeometry)) {
      return;
    }

    // Compute the axis-aligned world-space box so helper can live on
    // the scene root without inheriting the model's transform.
    const worldBounds = new Box3().setFromObject(child);
    if (worldBounds.isEmpty()) {
      return;
    }

    const helper = new Box3Helper(worldBounds, 0x7170ff);
    helper.userData[BBOX_HELPER_FLAG] = true;
    const materials = getMaterials(helper.material);
    for (const material of materials) {
      if ("depthTest" in material) {
        material.depthTest = false;
      }
      if ("transparent" in material) {
        material.transparent = true;
      }
    }
    helper.renderOrder = 2;
    scene.add(helper);
  });
}

function disposeNormalHelper(helper: VertexNormalsHelper) {
  helper.geometry.dispose();
  for (const material of getMaterials(helper.material)) {
    material.dispose();
  }
}

export function removeNormalHelpers(scene: Scene) {
  const toRemove: VertexNormalsHelper[] = [];
  scene.traverse((child: Object3D) => {
    if (
      child instanceof VertexNormalsHelper &&
      child.userData[NORMAL_HELPER_FLAG] === true
    ) {
      toRemove.push(child);
    }
  });
  for (const helper of toRemove) {
    helper.parent?.remove(helper);
    disposeNormalHelper(helper);
  }
}

export function applyNormalHelpers(
  scene: Scene,
  object: Group | Mesh,
  visible: boolean,
) {
  removeNormalHelpers(scene);
  if (!visible) {
    return;
  }

  // Pick a line length relative to the whole object so the normals
  // read correctly regardless of model scale. Per-mesh bounds would
  // make tiny meshes show huge spikes.
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const reference = Math.max(size.x, size.y, size.z, 0.001);
  const lineLength = reference * 0.02;

  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }
    if (
      child.userData[SKELETON_HELPER_FLAG] === true ||
      child.userData[BBOX_HELPER_FLAG] === true ||
      child.userData[NORMAL_HELPER_FLAG] === true
    ) {
      return;
    }

    const geometry = child.geometry;
    if (
      !(geometry instanceof BufferGeometry) ||
      geometry.getAttribute("normal") === undefined
    ) {
      return;
    }

    const helper = new VertexNormalsHelper(child, lineLength, 0x5ec4ff);
    helper.userData[NORMAL_HELPER_FLAG] = true;
    for (const material of getMaterials(helper.material)) {
      if ("depthTest" in material) {
        material.depthTest = false;
      }
      if ("transparent" in material) {
        material.transparent = true;
      }
    }
    helper.renderOrder = 2;
    scene.add(helper);
  });
}

export type TextureFilterMode = "nearest" | "linear" | "trilinear";

type FilterPair = {
  mag: MagnificationTextureFilter;
  min: MinificationTextureFilter;
};

const textureFilterMap: Record<TextureFilterMode, FilterPair> = {
  nearest: { mag: NearestFilter, min: NearestMipMapNearestFilter },
  linear: { mag: LinearFilter, min: LinearFilter },
  trilinear: { mag: LinearFilter, min: LinearMipMapLinearFilter },
};

export function applyTextureFilter(
  object: Group | Mesh,
  mode: TextureFilterMode,
) {
  const touched = new Set<Texture>();
  const { mag, min } = textureFilterMap[mode];

  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }
    if (
      child.userData[SKELETON_HELPER_FLAG] === true ||
      child.userData[BBOX_HELPER_FLAG] === true ||
      child.userData[NORMAL_HELPER_FLAG] === true
    ) {
      return;
    }

    for (const material of getMaterials(child.material)) {
      if (!material) continue;
      // Walk the material's texture-valued properties rather than the
      // authored slot list, so we catch engine-specific maps like
      // aoMap, envMap, etc. without having to enumerate them.
      for (const value of Object.values(material)) {
        if (!(value instanceof Texture) || touched.has(value)) continue;
        value.magFilter = mag;
        value.minFilter = min;
        value.needsUpdate = true;
        touched.add(value);
      }
    }
  });
}

export function applyVertexColors(
  object: Group | Mesh,
  useVertexColors: boolean,
) {
  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }
    // Skip helper meshes we add ourselves.
    if (
      child.userData[SKELETON_HELPER_FLAG] === true ||
      child.userData[BBOX_HELPER_FLAG] === true
    ) {
      return;
    }

    const geometry = child.geometry;
    const hasColorAttribute =
      geometry instanceof BufferGeometry &&
      geometry.getAttribute("color") !== undefined;

    for (const material of getMaterials(child.material)) {
      if (!material || !("vertexColors" in material)) {
        continue;
      }
      const original = material.userData.originalVertexColors;
      if (typeof original !== "boolean") {
        material.userData.originalVertexColors = Boolean(material.vertexColors);
      }
      const originalFlag = Boolean(
        material.userData.originalVertexColors ?? false,
      );
      // Only force vertexColors on when the geometry actually has a
      // color attribute; otherwise Three.js silently falls back to
      // white and the toggle looks broken. When off, restore whatever
      // the loader authored.
      material.vertexColors =
        useVertexColors && hasColorAttribute ? true : originalFlag;
      material.needsUpdate = true;
    }
  });
}

export function applyBackfaceCulling(
  object: Group | Mesh,
  backfaceCulling: boolean,
) {
  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    for (const material of getMaterials(child.material)) {
      if (!material || !("side" in material)) {
        continue;
      }

      // Remember the authored side the first time we touch the material so
      // toggling culling on can restore anything fancier than FrontSide
      // (e.g. DoubleSide leaves, decals) the loader set up.
      const originalSide = material.userData.originalSide ?? material.side;
      material.userData.originalSide = originalSide;
      material.side = backfaceCulling
        ? (originalSide ?? FrontSide)
        : DoubleSide;
      material.needsUpdate = true;
    }
  });
}

export function applyDisplayMode(
  object: Group | Mesh,
  displayMode: DisplayMode,
) {
  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    for (const material of getMaterials(child.material)) {
      if (!("wireframe" in material)) {
        continue;
      }

      material.wireframe =
        displayMode === "wireframe" || displayMode === "texturedWireframe";

      if ("map" in material) {
        const originalMap =
          material.userData.originalMap ?? material.map ?? null;
        material.userData.originalMap = originalMap;
        material.map =
          displayMode === "untextured" || displayMode === "wireframe"
            ? null
            : originalMap;
      }

      material.needsUpdate = true;
    }
  });
}

const UNLIT_ORIGINAL_KEY = "_ywUnlitOriginal";

export function applyUnlitMaterial(
  object: Group | Mesh | null,
  enabled: boolean,
) {
  if (!object) return;

  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) return;
    if (child.material instanceof ShadowMaterial) return;

    if (enabled) {
      if (child.userData[UNLIT_ORIGINAL_KEY] !== undefined) return;

      const materials = getMaterials(child.material);
      const unlitMaterials: MeshBasicMaterial[] = [];

      for (const mat of materials) {
        const unlit = new MeshBasicMaterial();

        // Restore the original texture even if applyDisplayMode nulled
        // the current map (e.g. during "untextured" mode).
        const originalMap =
          mat.userData.originalMap instanceof Texture
            ? mat.userData.originalMap
            : null;
        const effectiveMap = originalMap ?? ("map" in mat ? mat.map : null);
        if (effectiveMap) {
          unlit.map = effectiveMap;
        }

        if ("color" in mat && mat.color) {
          unlit.color.copy(mat.color);
        }
        unlit.transparent = mat.transparent;
        unlit.opacity = mat.opacity;
        unlit.alphaTest = mat.alphaTest;
        unlit.side = mat.side;
        unlit.depthWrite = mat.depthWrite;
        unlit.depthTest = mat.depthTest;
        unlit.wireframe = mat.wireframe;

        unlitMaterials.push(unlit);
      }

      child.userData[UNLIT_ORIGINAL_KEY] = child.material;
      child.material =
        unlitMaterials.length === 1 ? unlitMaterials[0] : unlitMaterials;
    } else {
      const original = child.userData[UNLIT_ORIGINAL_KEY];
      if (original === undefined) return;

      const currentMats = getMaterials(child.material);
      for (const mat of currentMats) {
        if (mat instanceof MeshBasicMaterial) {
          mat.dispose();
        }
      }

      child.material = original;
      delete child.userData[UNLIT_ORIGINAL_KEY];
    }
  });
}
