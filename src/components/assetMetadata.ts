export type HierarchyNode = {
  name: string;
  kind: string;
  children: HierarchyNode[];
  /** #46: full USD SdfPath surfaced from GLB node extras.primPath.
   * Present only when the asset went through the hierarchy-aware GLB
   * pipeline. `undefined` for non-USD assets (GLTF/FBX/OBJ). */
  primPath?: string;
};

export type TextureEntry = {
  id: string;
  label: string;
  channel: string;
  dimensions: string;
  thumbnailUrl: string | null;
  sourceKind: "embedded" | "external" | "standalone" | "unresolved" | "unknown";
};

/** A texture slot in a material, carrying only the name so the inspector
 * can display the source without needing to transfer the GPU texture object
 * across the viewer boundary. */
export type MaterialTextureSlot = {
  /** Three.js `Texture.name`, or the userData-derived path when available.
   * Falls back to the slot label (e.g. `"Base Color"`) when no name is
   * present on the texture. */
  name: string;
};

export type MaterialEntry = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  opacity: number;
  transparent: boolean;
  textureCount: number;
  /** Names of meshes that bind this material. Derived from the live
   * Three.js scene graph because the GLB → glTF → Three.js round-trip
   * drops authored USD prim paths; mesh names are the closest stand-in
   * the inspector can recover. Multiple meshes may share a material,
   * and a single mesh authoring an array material appears once per
   * slot. Empty when no mesh references the material (rare). */
  boundMeshes: string[];

  // ── Shader input slot detail (Issue #36) ──────────────────────────────
  /** RGBA base color factor. Alpha is derived from `Material.opacity`.
   * Present only for `MeshStandardMaterial` / `MeshPhongMaterial` /
   * `MeshBasicMaterial`; `null` otherwise. */
  baseColorFactor: [number, number, number, number] | null;
  /** `MeshStandardMaterial.metalness`. `null` for non-standard materials. */
  metallicFactor: number | null;
  /** `MeshStandardMaterial.roughness`. `null` for non-standard materials. */
  roughnessFactor: number | null;
  /** RGB emissive factor. Present for Standard / Phong; `null` otherwise. */
  emissiveFactor: [number, number, number] | null;
  /** Base-color / albedo texture, or `null` when none is assigned. */
  baseColorTexture: MaterialTextureSlot | null;
  /** Combined metallic-roughness texture (`metalnessMap`), or `null`. */
  metallicRoughnessTexture: MaterialTextureSlot | null;
  /** Normal map texture, or `null`. */
  normalTexture: MaterialTextureSlot | null;
  /** Emissive texture, or `null`. */
  emissiveTexture: MaterialTextureSlot | null;
  /** Alpha handling mode inferred from Three.js material flags and
   * `userData.gltfAlphaMode` when the glTF extras carry it. */
  alphaMode: "OPAQUE" | "MASK" | "BLEND" | "unknown";
  /** USD prim path surfaced through `material.userData.usdPrimPath` when
   * the asset went through the Phase-7 USD→GLB pipeline. `null` when the
   * round-trip drops the prim path (the common case for pure-GLB assets). */
  usdPrimPath: string | null;
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

export type ObjectInfo = {
  name: string;
  kind: string;
  visible: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  boundingBox: [number, number, number, number, number, number] | null;
  vertexCount: number | null;
  triangleCount: number | null;
  materialNames: string[];
  materialIds: string[];
  childCount: number | null;
  animatesWithClips: string[];
  userData: Record<string, unknown> | null;
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
  objectInfo: Record<string, ObjectInfo>;
};

export const emptyAssetMetadata: AssetMetadata | null = null;
