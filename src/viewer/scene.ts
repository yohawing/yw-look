import {
  AxesHelper,
  Bone,
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  GridHelper,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipMapLinearFilter,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
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
  Quaternion,
  Scene,
  ShadowMaterial,
  SkeletonHelper,
  SkinnedMesh,
  Texture,
  Vector3,
  WireframeGeometry,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { VertexNormalsHelper } from "three/examples/jsm/helpers/VertexNormalsHelper.js";
import type { DisplayMode, SceneContext } from "./types";
import {
  copyMmdOutlineMaterialUserData,
  isMmdOutlineMaterial,
  isMmdOutlineProxyObject,
} from "./mmd/userData";

import type {
  GridConfig,
  CameraPreset,
  ScaleNormalizationResult,
  TextureFilterMode,
} from "../types/viewer";

export type {
  GridConfig,
  ScaleNormalizationResult,
  CameraPreset,
  TextureFilterMode,
} from "../types/viewer";

export const GRID_NAME = "__yw_initial_grid";
export const AXES_NAME = "__yw_axes_helper";
export const SHADOW_CATCHER_NAME = "__yw_shadow_catcher";
const SKELETON_HELPER_FLAG = "__yw_skeleton_helper";
const JOINT_AXIS_HELPER_FLAG = "__yw_joint_axis_helper";
const JOINT_LABEL_HELPER_FLAG = "__yw_joint_label_helper";
const BBOX_HELPER_FLAG = "__yw_bbox_helper";
const NORMAL_HELPER_FLAG = "__yw_normal_helper";
const WIREFRAME_OVERLAY_FLAG = "__yw_wireframe_overlay";
const WIREFRAME_PROXY_FLAG = "__yw_wireframe_proxy";
const WIREFRAME_OVERLAY_COLOR_TOKEN = "--yl-accent-bg";
const WIREFRAME_OVERLAY_COLOR_FALLBACK = "#5e6ad2";
const WIREFRAME_MATERIAL_COLOR_TOKEN = "--yl-text-primary";
const WIREFRAME_MATERIAL_COLOR_FALLBACK = "#f7f8f8";
const WIREFRAME_ORIGINAL_COLOR_KEY = "__yw_wireframe_original_color";
const WIREFRAME_ORIGINAL_MATERIAL_KEY = "__yw_wireframe_original_material";
const WIREFRAME_MATERIAL_FLAG = "__yw_wireframe_material";
const GRID_DIVISIONS = 20;
const JOINT_AXIS_SIZE_FACTOR = 0.02 / 3;
const JOINT_AXIS_MIN_SIZE = 0.015;
// Axes length is tied to grid size so the XYZ indicator scales with the
// current unit preset. Slightly longer than half a grid cell keeps the
// arrows visible but avoids punching through a model that fills the grid.
const AXES_LENGTH_FACTOR = 0.6;
const MIN_NORMALIZED_DIMENSION = 0.1;
const MAX_NORMALIZED_DIMENSION = 100;
const SCALE_EPSILON = 1e-8;
export const DEFAULT_SCENE_DIMENSION = 1;

const boneWorldScaleScratch = new Vector3();
const localAxisXScratch = new Vector3();
const localAxisYScratch = new Vector3();
const localAxisZScratch = new Vector3();
const localAxisMatrixScratch = new Matrix4();
const localAxisQuaternionScratch = new Quaternion();

type GridPreset = {
  maxDimension: number;
  cellSize: number;
  label: string;
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

function isMmdOutlineMesh(mesh: Mesh) {
  if (isMmdOutlineProxyObject(mesh)) {
    return true;
  }

  const storedOriginal = getWireframeOriginalMaterial(mesh);
  const materials =
    storedOriginal !== undefined
      ? [...getMaterials(mesh.material), ...getMaterials(storedOriginal)]
      : getMaterials(mesh.material);
  return materials.some(isMmdOutlineMaterial);
}

export function isViewportHelperObject(child: Object3D) {
  return (
    child.userData[SKELETON_HELPER_FLAG] === true ||
    child.userData[JOINT_AXIS_HELPER_FLAG] === true ||
    child.userData[JOINT_LABEL_HELPER_FLAG] === true ||
    child.userData[BBOX_HELPER_FLAG] === true ||
    child.userData[NORMAL_HELPER_FLAG] === true ||
    child.userData[WIREFRAME_OVERLAY_FLAG] === true ||
    child.userData[WIREFRAME_PROXY_FLAG] === true
  );
}

function readCssColorToken(token: string, fallback: string) {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle === "undefined"
  ) {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();

  return value || fallback;
}

function usesDeformedGeometry(mesh: Mesh) {
  return (
    mesh instanceof InstancedMesh ||
    mesh instanceof SkinnedMesh ||
    (Array.isArray(mesh.morphTargetInfluences) &&
      mesh.morphTargetInfluences.length > 0)
  );
}

function createWireframeMaterial(source: Material, color: Color) {
  const material = new MeshBasicMaterial({
    color,
    wireframe: true,
    side: source.side,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    transparent: source.transparent || source.opacity < 1,
    opacity: source.opacity,
  });
  material.visible = source.visible;
  material.toneMapped = false;
  material.userData[WIREFRAME_MATERIAL_FLAG] = true;
  copyMmdOutlineMaterialUserData(material, source);
  return material;
}

function createWireframeMaterialSet(
  source: Material | Material[],
  color: Color,
) {
  return Array.isArray(source)
    ? source.map((material) => createWireframeMaterial(material, color))
    : createWireframeMaterial(source, color);
}

function disposeWireframeMaterialSet(material: Material | Material[]) {
  for (const item of getMaterials(material)) {
    if (item.userData[WIREFRAME_MATERIAL_FLAG] === true) {
      item.dispose();
    }
  }
}

function getWireframeOriginalMaterial(mesh: Mesh) {
  return mesh.userData[WIREFRAME_ORIGINAL_MATERIAL_KEY] as
    | Material
    | Material[]
    | undefined;
}

function setWireframeOriginalMaterial(
  mesh: Mesh,
  material: Material | Material[],
) {
  mesh.userData[WIREFRAME_ORIGINAL_MATERIAL_KEY] = material;
}

function getMaterialControlTargets(mesh: Mesh) {
  const storedOriginal = getWireframeOriginalMaterial(mesh);
  return storedOriginal !== undefined
    ? [...getMaterials(mesh.material), ...getMaterials(storedOriginal)]
    : getMaterials(mesh.material);
}

function applyWireframeMaterialOverride(mesh: Mesh, color: Color) {
  const storedOriginal = getWireframeOriginalMaterial(mesh);
  if (storedOriginal !== undefined) {
    disposeWireframeMaterialSet(mesh.material);
    mesh.material = createWireframeMaterialSet(storedOriginal, color);
    return;
  }

  const original = mesh.material;
  setWireframeOriginalMaterial(mesh, original);
  mesh.material = createWireframeMaterialSet(original, color);
}

function restoreWireframeMaterialOverride(mesh: Mesh) {
  const original = getWireframeOriginalMaterial(mesh);
  if (original === undefined) {
    return;
  }

  disposeWireframeMaterialSet(mesh.material);
  mesh.material = original;
  delete mesh.userData[WIREFRAME_ORIGINAL_MATERIAL_KEY];
}

function createWireframeOverlayMeshMaterial(source: Material, color: Color) {
  const material = new MeshBasicMaterial({
    color,
    wireframe: true,
    side: source.side,
    transparent: source.transparent || source.opacity < 1,
    opacity: source.opacity,
    depthTest: source.depthTest,
    depthWrite: false,
  });
  material.visible = source.visible;
  material.toneMapped = false;
  return material;
}

function createWireframeOverlayMeshMaterialSet(
  source: Material | Material[],
  color: Color,
) {
  return Array.isArray(source)
    ? source.map((material) =>
        createWireframeOverlayMeshMaterial(material, color),
      )
    : createWireframeOverlayMeshMaterial(source, color);
}

function shareMorphTargetState(source: Mesh, proxy: Mesh) {
  proxy.morphTargetDictionary = source.morphTargetDictionary;
  proxy.morphTargetInfluences = source.morphTargetInfluences;
}

function createDeformedWireframeProxy(source: Mesh, color: Color) {
  if (!(source.geometry instanceof BufferGeometry)) {
    return null;
  }
  if (source.geometry.getAttribute("position") === undefined) {
    return null;
  }

  const material = createWireframeOverlayMeshMaterialSet(
    source.material,
    color,
  );
  let proxy: Mesh;

  if (source instanceof SkinnedMesh) {
    const skinnedProxy = new SkinnedMesh(source.geometry, material);
    skinnedProxy.bindMode = source.bindMode;
    skinnedProxy.bind(source.skeleton, source.bindMatrix);
    proxy = skinnedProxy;
  } else if (source instanceof InstancedMesh) {
    const instancedProxy = new InstancedMesh(
      source.geometry,
      material,
      source.count,
    );
    instancedProxy.instanceMatrix = source.instanceMatrix;
    instancedProxy.instanceColor = source.instanceColor;
    instancedProxy.count = source.count;
    proxy = instancedProxy;
  } else {
    proxy = new Mesh(source.geometry, material);
  }

  shareMorphTargetState(source, proxy);
  proxy.name = "__yw_textured_wireframe_proxy";
  proxy.userData[WIREFRAME_OVERLAY_FLAG] = true;
  proxy.userData[WIREFRAME_PROXY_FLAG] = true;
  proxy.frustumCulled = source.frustumCulled;
  proxy.renderOrder = source.renderOrder + 1;
  proxy.visible = source.visible;
  return proxy;
}

function disposeWireframeOverlayObject(overlay: Object3D) {
  if (
    overlay instanceof LineSegments &&
    overlay.geometry instanceof BufferGeometry
  ) {
    overlay.geometry.dispose();
    for (const material of getMaterials(overlay.material)) {
      material.dispose();
    }
  }

  if (overlay instanceof Mesh) {
    for (const material of getMaterials(overlay.material)) {
      material.dispose();
    }
    const unlitOriginal = overlay.userData[UNLIT_ORIGINAL_KEY];
    if (unlitOriginal instanceof Material || Array.isArray(unlitOriginal)) {
      for (const material of getMaterials(unlitOriginal)) {
        material.dispose();
      }
      delete overlay.userData[UNLIT_ORIGINAL_KEY];
    }
  }
}

function applyDisplayModeToMaterial(
  material: Material,
  displayMode: DisplayMode,
  useMaterialWireframe: boolean,
  wireframeColor: Color,
) {
  if (!("wireframe" in material)) {
    return;
  }

  material.wireframe = useMaterialWireframe;

  if ("color" in material && material.color instanceof Color) {
    if (displayMode === "wireframe") {
      if (!(material.userData[WIREFRAME_ORIGINAL_COLOR_KEY] instanceof Color)) {
        material.userData[WIREFRAME_ORIGINAL_COLOR_KEY] =
          material.color.clone();
      }
      material.color.copy(wireframeColor);
    } else {
      const originalColor = material.userData[WIREFRAME_ORIGINAL_COLOR_KEY];
      if (originalColor instanceof Color) {
        material.color.copy(originalColor);
        delete material.userData[WIREFRAME_ORIGINAL_COLOR_KEY];
      }
    }
  }

  if ("map" in material) {
    const originalMap = material.userData.originalMap ?? material.map ?? null;
    material.userData.originalMap = originalMap;
    material.map =
      displayMode === "untextured" || displayMode === "wireframe"
        ? null
        : originalMap;
  }

  material.needsUpdate = true;
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
    if (child.userData[WIREFRAME_OVERLAY_FLAG] === true) {
      disposeWireframeOverlayObject(child);
      return;
    }

    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      child.geometry.dispose();
    }

    if (child instanceof Mesh) {
      const materialsToDispose = [
        ...getMaterials(child.material),
        ...(child.userData[WIREFRAME_ORIGINAL_MATERIAL_KEY] !== undefined
          ? getMaterials(
              child.userData[WIREFRAME_ORIGINAL_MATERIAL_KEY] as
                | Material
                | Material[],
            )
          : []),
      ];
      for (const material of materialsToDispose) {
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
  context.animationRoot = null;
  context.mixer = null;
  context.clips = [];
  context.mmdMotion = null;
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
  context.boneOnlyPreview = false;
  context.animationRoot = null;
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

const HOME_VIEW_DIRECTION = new Vector3(1.15, 0.8, 1.15).normalize();
const DEFAULT_CAMERA_POSITION = new Vector3(5, 4, 5);
const DEFAULT_CAMERA_TARGET = new Vector3(0, 0, 0);

function getStoredPositiveDimension(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function computeCameraFitDistance(
  camera: PerspectiveCamera,
  maxDimension: number,
) {
  return (
    (maxDimension / (2 * Math.tan(MathUtils.degToRad(camera.fov * 0.5)))) * 1.5
  );
}

function getBoneBounds(object: Group | Mesh) {
  const bounds = new Box3();
  const position = new Vector3();
  let hasBone = false;

  object.updateWorldMatrix(true, true);
  object.traverse((child: Object3D) => {
    if (!(child instanceof Bone)) {
      return;
    }
    hasBone = true;
    bounds.expandByPoint(child.getWorldPosition(position));
  });

  return hasBone ? bounds : null;
}

function getObjectBounds(object: Group | Mesh) {
  const bounds = new Box3().setFromObject(object);
  if (!bounds.isEmpty()) {
    return bounds;
  }
  return getBoneBounds(object) ?? bounds;
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
  // Gaussian splats opt out of bounds-based auto framing (Issue #98): many
  // captures are navigated from the authored origin instead of framed as a
  // whole object, and outlier splats would zoom the camera way out.
  if (object.userData?.disableAutoFrame) {
    camera.position.copy(DEFAULT_CAMERA_POSITION);
    camera.near = 0.01;
    camera.far = 100_000;
    camera.lookAt(DEFAULT_CAMERA_TARGET);
    camera.updateProjectionMatrix();
    controls.target.copy(DEFAULT_CAMERA_TARGET);
    controls.minDistance = 0.01;
    controls.maxDistance = 100_000;
    applyControlsSensitivity(
      controls,
      rawMaxDimension && rawMaxDimension > 0
        ? rawMaxDimension
        : DEFAULT_SCENE_DIMENSION,
      sensitivityMultiplier,
    );
    controls.update();
    return;
  }

  const bounds = getObjectBounds(object);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const fitDistance = computeCameraFitDistance(camera, maxDimension);
  const offset = HOME_VIEW_DIRECTION.clone().multiplyScalar(fitDistance);

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
  const useFixedAutoFrame = Boolean(object.userData?.disableAutoFrame);
  const bounds = useFixedAutoFrame ? null : getObjectBounds(object);
  const size = bounds?.getSize(new Vector3());
  const center = useFixedAutoFrame
    ? DEFAULT_CAMERA_TARGET.clone()
    : (bounds?.getCenter(new Vector3()) ?? new Vector3());
  const maxDimension = useFixedAutoFrame
    ? DEFAULT_SCENE_DIMENSION
    : size
      ? Math.max(size.x, size.y, size.z, 0.001)
      : DEFAULT_SCENE_DIMENSION;
  const fitDistance = useFixedAutoFrame
    ? DEFAULT_CAMERA_POSITION.length()
    : computeCameraFitDistance(camera, maxDimension);

  const direction = cameraPresetDirections[preset].clone().normalize();
  const offset = direction.multiplyScalar(fitDistance);
  camera.position.copy(center.clone().add(offset));

  const upOverride = cameraPresetUpOverrides[preset];
  camera.up.copy(upOverride ?? new Vector3(0, 1, 0));

  camera.near = useFixedAutoFrame ? 0.01 : Math.max(maxDimension / 500, 0.01);
  camera.far = useFixedAutoFrame ? 100_000 : Math.max(maxDimension * 20, 200);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = useFixedAutoFrame
    ? 0.01
    : Math.max(maxDimension / 50, 0.05);
  controls.maxDistance = useFixedAutoFrame
    ? 100_000
    : Math.max(maxDimension * 40, 50);
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
  if (object.userData?.disableAutoFrame) {
    return (
      getStoredPositiveDimension(object.userData.splatBoundsMaxDimension) ??
      DEFAULT_SCENE_DIMENSION
    );
  }
  const bounds = getObjectBounds(object);
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
    if (isViewportHelperObject(child)) return;
    if (isMmdOutlineMesh(child)) return;
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

function disposeAxesHelper(helper: AxesHelper) {
  helper.geometry.dispose();
  for (const material of getMaterials(helper.material)) {
    material.dispose();
  }
}

function disposeJointLabel(label: CSS2DObject) {
  label.element.remove();
}

function isBoneObject(object: Object3D): object is Bone {
  return (
    object instanceof Bone ||
    object.type === "Bone" ||
    (object as Object3D & { isBone?: unknown }).isBone === true
  );
}

function collectBonesForRoots(roots: Object3D[]) {
  const seen = new Set<Object3D>();
  const bones: Object3D[] = [];
  for (const root of roots) {
    root.traverse((child) => {
      if (!isBoneObject(child) || seen.has(child)) {
        return;
      }
      seen.add(child);
      bones.push(child);
    });
  }
  return bones;
}

function collectBones(object: Group | Mesh) {
  const bones: Object3D[] = [];
  object.traverse((child: Object3D) => {
    if (isBoneObject(child)) {
      bones.push(child);
    }
  });
  return bones;
}

function getJointAxisTargetWorldSize(object: Group | Mesh) {
  const maxDimension = getObjectMaxDimension(object);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    return JOINT_AXIS_MIN_SIZE;
  }
  return Math.max(maxDimension * JOINT_AXIS_SIZE_FACTOR, JOINT_AXIS_MIN_SIZE);
}

function getBoneWorldScaleFactor(bone: Object3D) {
  bone.getWorldScale(boneWorldScaleScratch);
  const factor = Math.max(
    Math.abs(boneWorldScaleScratch.x),
    Math.abs(boneWorldScaleScratch.y),
    Math.abs(boneWorldScaleScratch.z),
  );
  return Number.isFinite(factor) && factor > SCALE_EPSILON ? factor : 1;
}

function getJointAxisSize(bone: Object3D, targetWorldSize: number) {
  return Math.max(
    targetWorldSize / getBoneWorldScaleFactor(bone),
    JOINT_AXIS_MIN_SIZE,
  );
}

type MmdLocalAxisUserData = {
  x?: unknown;
  z?: unknown;
};

function readVector3Tuple(value: unknown, target: Vector3) {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  const [x, y, z] = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return null;
  }
  return target.set(x, y, z);
}

function getMmdLocalAxisQuaternion(bone: Object3D) {
  const localAxis = bone.userData.mmdLocalAxis as
    | MmdLocalAxisUserData
    | undefined;
  if (!localAxis || typeof localAxis !== "object") {
    return null;
  }

  const localX = readVector3Tuple(localAxis.x, localAxisXScratch);
  const localZ = readVector3Tuple(localAxis.z, localAxisZScratch);
  if (!localX || !localZ) {
    return null;
  }

  localX.normalize();
  localZ.addScaledVector(localX, -localZ.dot(localX)).normalize();
  if (
    localX.lengthSq() <= SCALE_EPSILON ||
    localZ.lengthSq() <= SCALE_EPSILON
  ) {
    return null;
  }

  localAxisYScratch.crossVectors(localZ, localX).normalize();
  if (localAxisYScratch.lengthSq() <= SCALE_EPSILON) {
    return null;
  }

  localAxisMatrixScratch.makeBasis(localX, localAxisYScratch, localZ);
  localAxisQuaternionScratch.setFromRotationMatrix(localAxisMatrixScratch);
  localAxisQuaternionScratch.set(
    -localAxisQuaternionScratch.x,
    -localAxisQuaternionScratch.y,
    localAxisQuaternionScratch.z,
    localAxisQuaternionScratch.w,
  );
  return localAxisQuaternionScratch;
}

function getBoneLabelText(bone: Object3D) {
  const mmdName = bone.userData.mmdBoneName;
  const mmdEnglishName = bone.userData.mmdEnglishBoneName;
  if (typeof mmdName === "string" && mmdName.trim().length > 0) {
    return mmdName.trim();
  }
  if (typeof mmdEnglishName === "string" && mmdEnglishName.trim().length > 0) {
    return mmdEnglishName.trim();
  }
  return bone.name.trim();
}

function createJointLabel(text: string) {
  const element = document.createElement("span");
  element.className = "joint-name-label";
  element.textContent = text;
  const label = new CSS2DObject(element);
  label.userData[JOINT_LABEL_HELPER_FLAG] = true;
  label.renderOrder = 3;
  return label;
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
    if (isMmdOutlineMesh(child)) {
      return;
    }
    const firstBone = child.skeleton.bones[0];
    if (!firstBone) {
      return;
    }
    // Walk up to the highest bone so the helper draws the full chain.
    let root: Object3D = firstBone;
    while (root.parent && isBoneObject(root.parent)) {
      root = root.parent as Object3D;
    }
    if (seen.has(root)) {
      return;
    }
    seen.add(root);
    roots.push(root);
  });
  object.traverse((child: Object3D) => {
    if (!isBoneObject(child)) {
      return;
    }
    let root: Object3D = child;
    while (root.parent && isBoneObject(root.parent)) {
      root = root.parent;
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
  const axesToRemove: AxesHelper[] = [];
  const labelsToRemove: CSS2DObject[] = [];
  scene.traverse((child: Object3D) => {
    if (
      child instanceof SkeletonHelper &&
      child.userData[SKELETON_HELPER_FLAG] === true
    ) {
      toRemove.push(child);
      return;
    }
    if (
      child instanceof AxesHelper &&
      child.userData[JOINT_AXIS_HELPER_FLAG] === true
    ) {
      axesToRemove.push(child);
      return;
    }
    if (
      child instanceof CSS2DObject &&
      child.userData[JOINT_LABEL_HELPER_FLAG] === true
    ) {
      labelsToRemove.push(child);
    }
  });
  for (const helper of toRemove) {
    helper.parent?.remove(helper);
    disposeSkeletonHelper(helper);
  }
  for (const helper of axesToRemove) {
    helper.parent?.remove(helper);
    disposeAxesHelper(helper);
  }
  for (const label of labelsToRemove) {
    label.parent?.remove(label);
    disposeJointLabel(label);
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
  showLocalAxis = true,
  showJointNames = false,
) {
  removeSkeletonHelpers(scene);
  if (!visible) {
    return;
  }

  object.updateWorldMatrix(true, true);
  const roots = collectSkeletonRoots(object);
  const bones =
    roots.length > 0 ? collectBonesForRoots(roots) : collectBones(object);
  const targetAxisWorldSize = getJointAxisTargetWorldSize(object);
  for (const root of roots) {
    if (visible) {
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
  for (const bone of bones) {
    if (showLocalAxis) {
      const axisSize = getJointAxisSize(bone, targetAxisWorldSize);
      const axis = new AxesHelper(axisSize);
      const localAxisQuaternion = getMmdLocalAxisQuaternion(bone);
      if (localAxisQuaternion) {
        axis.quaternion.copy(localAxisQuaternion);
      }
      axis.userData[JOINT_AXIS_HELPER_FLAG] = true;
      axis.renderOrder = 3;
      for (const material of getMaterials(axis.material)) {
        if ("depthTest" in material) {
          material.depthTest = false;
        }
        if ("transparent" in material) {
          material.transparent = true;
        }
      }
      bone.add(axis);
    }
    if (showJointNames) {
      const text = getBoneLabelText(bone);
      if (text.length > 0) {
        bone.add(createJointLabel(text));
      }
    }
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
    if (isViewportHelperObject(child)) {
      return;
    }
    if (isMmdOutlineMesh(child)) {
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
    if (isViewportHelperObject(child)) {
      return;
    }
    if (isMmdOutlineMesh(child)) {
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
    if (isViewportHelperObject(child)) {
      return;
    }
    if (isMmdOutlineMesh(child)) {
      return;
    }
    if (
      child.userData[SKELETON_HELPER_FLAG] === true ||
      child.userData[BBOX_HELPER_FLAG] === true ||
      child.userData[NORMAL_HELPER_FLAG] === true
    ) {
      return;
    }

    for (const material of getMaterialControlTargets(child)) {
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
    if (isViewportHelperObject(child)) {
      return;
    }
    if (isMmdOutlineMesh(child)) {
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

    for (const material of getMaterialControlTargets(child)) {
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
    if (isViewportHelperObject(child)) {
      return;
    }
    if (isMmdOutlineMesh(child)) {
      return;
    }

    for (const material of getMaterialControlTargets(child)) {
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
  const showWireframeOverlay = displayMode === "texturedWireframe";
  const wireframeColor = new Color(
    readCssColorToken(
      WIREFRAME_OVERLAY_COLOR_TOKEN,
      WIREFRAME_OVERLAY_COLOR_FALLBACK,
    ),
  );
  const wireframeMaterialColor = new Color(
    readCssColorToken(
      WIREFRAME_MATERIAL_COLOR_TOKEN,
      WIREFRAME_MATERIAL_COLOR_FALLBACK,
    ),
  );

  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }
    if (isViewportHelperObject(child)) {
      return;
    }

    const isMmdOutline = isMmdOutlineMesh(child);
    const existingOverlays = child.children.filter(
      (candidate) => candidate.userData[WIREFRAME_OVERLAY_FLAG] === true,
    );
    for (const overlay of existingOverlays) {
      child.remove(overlay);
      disposeWireframeOverlayObject(overlay);
    }

    if (displayMode === "wireframe") {
      applyWireframeMaterialOverride(child, wireframeMaterialColor);
      return;
    }
    restoreWireframeMaterialOverride(child);

    if (
      !isMmdOutline &&
      showWireframeOverlay &&
      usesDeformedGeometry(child) &&
      child.geometry instanceof BufferGeometry &&
      child.geometry.getAttribute("position") !== undefined
    ) {
      const proxy = createDeformedWireframeProxy(child, wireframeColor);
      if (proxy) {
        child.add(proxy);
      }
    } else if (
      !isMmdOutline &&
      showWireframeOverlay &&
      child.geometry instanceof BufferGeometry &&
      child.geometry.getAttribute("position") !== undefined
    ) {
      const overlay = new LineSegments(
        new WireframeGeometry(child.geometry),
        new LineBasicMaterial({
          color: wireframeColor,
          transparent: true,
          opacity: 0.78,
          depthTest: true,
          depthWrite: false,
        }),
      );
      overlay.name = "__yw_textured_wireframe_overlay";
      overlay.userData[WIREFRAME_OVERLAY_FLAG] = true;
      overlay.renderOrder = child.renderOrder + 1;
      child.add(overlay);
    }

    for (const material of getMaterials(child.material)) {
      applyDisplayModeToMaterial(material, displayMode, false, wireframeColor);
    }

    const unlitOriginal = child.userData[UNLIT_ORIGINAL_KEY];
    if (unlitOriginal instanceof Material || Array.isArray(unlitOriginal)) {
      for (const material of getMaterials(unlitOriginal)) {
        applyDisplayModeToMaterial(
          material,
          displayMode,
          false,
          wireframeColor,
        );
      }
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
    if (isViewportHelperObject(child)) return;
    if (isMmdOutlineMesh(child)) return;
    if (child.material instanceof ShadowMaterial) return;

    if (enabled) {
      if (child.userData[UNLIT_ORIGINAL_KEY] !== undefined) return;

      const storedWireframeOriginal = getWireframeOriginalMaterial(child);
      const currentMaterial = storedWireframeOriginal ?? child.material;
      const materials = getMaterials(currentMaterial);
      const unlitMaterials: MeshBasicMaterial[] = [];

      for (const mat of materials) {
        const unlit = new MeshBasicMaterial();

        // Restore the original texture even if applyDisplayMode nulled
        // the current map (e.g. during "untextured" mode).
        const originalMap =
          mat.userData.originalMap instanceof Texture
            ? mat.userData.originalMap
            : null;
        const effectiveMap =
          originalMap ??
          ("map" in mat && mat.map instanceof Texture ? mat.map : null);
        if (effectiveMap instanceof Texture) {
          unlit.map = effectiveMap;
        }

        if ("color" in mat && mat.color instanceof Color) {
          unlit.color.copy(mat.color);
          const originalWireframeColor =
            mat.userData[WIREFRAME_ORIGINAL_COLOR_KEY];
          if (originalWireframeColor instanceof Color) {
            unlit.userData[WIREFRAME_ORIGINAL_COLOR_KEY] =
              originalWireframeColor.clone();
          }
        }
        unlit.transparent = mat.transparent;
        unlit.opacity = mat.opacity;
        unlit.alphaTest = mat.alphaTest;
        unlit.side = mat.side;
        unlit.depthWrite = mat.depthWrite;
        unlit.depthTest = mat.depthTest;
        if ("wireframe" in mat && typeof mat.wireframe === "boolean") {
          unlit.wireframe = mat.wireframe;
        }

        unlitMaterials.push(unlit);
      }

      const unlitMaterial =
        unlitMaterials.length === 1 ? unlitMaterials[0] : unlitMaterials;
      child.userData[UNLIT_ORIGINAL_KEY] = currentMaterial;
      if (storedWireframeOriginal !== undefined) {
        setWireframeOriginalMaterial(child, unlitMaterial);
      } else {
        child.material = unlitMaterial;
      }
    } else {
      const original = child.userData[UNLIT_ORIGINAL_KEY];
      if (original === undefined) return;

      const storedWireframeOriginal = getWireframeOriginalMaterial(child);
      const currentMats = getMaterials(
        storedWireframeOriginal ?? child.material,
      );
      for (const mat of currentMats) {
        if (mat instanceof MeshBasicMaterial) {
          mat.dispose();
        }
      }

      if (storedWireframeOriginal !== undefined) {
        setWireframeOriginalMaterial(child, original);
      } else {
        child.material = original;
      }
      delete child.userData[UNLIT_ORIGINAL_KEY];
    }
  });
}
