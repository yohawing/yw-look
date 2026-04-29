export type HierarchyNode = {
  name: string;
  kind: string;
  children: HierarchyNode[];
};

export type TextureEntry = {
  id: string;
  label: string;
  channel: string;
  dimensions: string;
  thumbnailUrl: string | null;
  sourceKind: "embedded" | "external" | "standalone" | "unresolved" | "unknown";
};

export type MaterialEntry = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  opacity: number;
  transparent: boolean;
  textureCount: number;
};

/** One light surfaced in the scene panel. Authored by USD as
 * `UsdLuxDistantLight` / `SphereLight` / etc. and lowered to a
 * Three.js `Light` instance by GLTFLoader's `KHR_lights_punctual`
 * extension. The frontend re-derives this from the live scene graph
 * because Three.js loses the original USD prim path during the
 * GLB → glTF → Three.js round-trip. */
export type LightEntry = {
  id: string;
  name: string;
  /** Three.js `light.type` (e.g. `"DirectionalLight"`,
   * `"PointLight"`, `"SpotLight"`, `"AmbientLight"`,
   * `"HemisphereLight"`). */
  type: string;
  /** Hex color of the emitted light, or `null` when the light type
   * does not expose a color (rare). */
  color: string | null;
  /** glTF `KHR_lights_punctual` intensity in candela (point/spot) or
   * lux (directional). Three.js stores this directly on `light.intensity`. */
  intensity: number;
};

/** One camera authored on the stage. USD `UsdGeomCamera` prims are
 * lowered to glTF `cameras` by the Phase 7b backend pass, and
 * GLTFLoader instantiates them as Three.js `PerspectiveCamera` (or
 * `OrthographicCamera` once Phase 7b ortho support lands) attached to
 * the scene graph. Switching the active camera is a separate task —
 * this entry exists so the inspector can list authored cameras even
 * while the viewer keeps using its own orbit camera. */
export type CameraEntry = {
  id: string;
  name: string;
  /** `"perspective"` for `PerspectiveCamera`, `"orthographic"`
   * otherwise. */
  projection: "perspective" | "orthographic";
  /** Vertical field of view in degrees. `null` for orthographic. */
  fov: number | null;
  /** Width / height ratio reported by Three.js. `null` for orthographic. */
  aspect: number | null;
  near: number;
  far: number;
};

export type AssetMetadata = {
  formatLabel: string;
  formatVersion: string | null;
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  hasAnimation: boolean;
  hierarchy: HierarchyNode[];
  textures: TextureEntry[];
  materials: MaterialEntry[];
  lights: LightEntry[];
  cameras: CameraEntry[];
};

export const emptyAssetMetadata: AssetMetadata | null = null;
