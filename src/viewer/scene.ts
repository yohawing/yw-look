import {
  Box3,
  BufferGeometry,
  GridHelper,
  Group,
  Material,
  MathUtils,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DisplayMode, SceneContext } from "./types";

export const GRID_NAME = "__yw_initial_grid";
const GRID_DIVISIONS = 20;
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
    };
  }

  let factor = 1;
  if (originalMaxDimension < MIN_NORMALIZED_DIMENSION) {
    factor = MIN_NORMALIZED_DIMENSION / originalMaxDimension;
  } else if (originalMaxDimension > MAX_NORMALIZED_DIMENSION) {
    factor = MAX_NORMALIZED_DIMENSION / originalMaxDimension;
  }

  const applied = Math.abs(factor - 1) > SCALE_EPSILON;
  if (applied) {
    object.scale.multiplyScalar(factor);
    object.updateMatrixWorld(true);
  }

  return {
    applied,
    factor,
    originalMaxDimension,
    normalizedMaxDimension: getObjectMaxDimension(object),
  };
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

function formatScaleFactor(factor: number) {
  if (!Number.isFinite(factor) || factor === 0) {
    return "0";
  }

  const magnitude = Math.abs(factor);
  if (magnitude < 0.0001 || magnitude >= 10000) {
    return factor.toExponential(4);
  }

  return factor.toFixed(4);
}

export function getScaleWarning(
  object: Group | Mesh,
  normalized: ScaleNormalizationResult | null = null,
) {
  if (normalized?.applied) {
    return `Scale normalized automatically (x${formatScaleFactor(normalized.factor)}).`;
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
