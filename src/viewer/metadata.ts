import {
  AnimationClip,
  Camera,
  Color,
  Group,
  Light,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Texture,
} from "three";
import type { SelectedFile } from "../lib/files";
import type {
  AssetMetadata,
  CameraEntry,
  HierarchyNode,
  LightEntry,
  MaterialEntry,
  MaterialTextureSlot,
} from "../components/assetMetadata";
import type { TextureSlotKey, TexturedMaterial } from "./types";
import { getMaterials } from "./scene";

export type MetadataCollection = {
  metadata: AssetMetadata;
  textureRegistry: Map<string, Texture>;
};

function getObjectKind(object: Object3D) {
  if (object instanceof Mesh) {
    return "mesh";
  }

  if (object instanceof Group) {
    return "group";
  }

  return object.type.toLowerCase();
}

/** Trim `Object3D.name` while tolerating loaders that leave the field as
 * `null` (notably ColladaLoader). Returns an empty string when the input
 * is non-string so callers can fall back to type names. */
function safeTrimmedName(object: Object3D): string {
  const rawName = typeof object.name === "string" ? object.name : "";
  return rawName.trim();
}

/** Last component of a SdfPath (e.g. `"/A/B/Cube"` → `"Cube"`). */
function basenameFromPrimPath(primPath: string): string {
  const idx = primPath.lastIndexOf("/");
  if (idx < 0) return primPath;
  return primPath.slice(idx + 1);
}

/** True for nodes that yw-look's USD→GLB pipeline inserts internally
 * and that should never appear in the user-facing hierarchy. The
 * predicate is intentionally narrow so non-USD formats (DAE, OBJ, …)
 * with their own legitimate unnamed groups are unaffected:
 *  - `__upAxis`: synthetic Z→Y correction wrapper (#46)
 *  - GLTFLoader's outer scene root, but ONLY when it is the parent of
 *    a `__upAxis` node — that pairing uniquely identifies our pipeline
 *    and avoids collapsing genuine unnamed Groups produced by other
 *    loaders (ColladaLoader, GLTFLoader for non-yw-look glTF, …). */
function isSyntheticWrapper(object: Object3D): boolean {
  if (object.name === "__upAxis") return true;
  if (
    object instanceof Group &&
    safeTrimmedName(object) === "" &&
    typeof object.userData?.primPath !== "string" &&
    object.children.some((child) => child.name === "__upAxis")
  ) {
    return true;
  }
  return false;
}

/** Recursively map an Object3D into a HierarchyNode, **inlining** any
 * synthetic wrapper nodes so they are transparent to the user. The
 * caller is expected to start from a non-wrapper root; if the root
 * itself is a wrapper, use `buildHierarchyForest` to skip past it. */
function buildHierarchyNode(object: Object3D): HierarchyNode {
  // Keep an empty string when the node has no authored name. The
  // display layer (HierarchyCard) substitutes "(unnamed)" purely for
  // the visible label; storing that placeholder in `name` would leak
  // the parens into USD prim path construction (#28) and trigger
  // `Ill-formed SdfPath` warnings when the C++ backend tries to
  // resolve `/(unnamed)/...`.
  const primPath: string | undefined =
    typeof object.userData?.primPath === "string"
      ? object.userData.primPath
      : undefined;
  // Three.js GLTFLoader appends `_1`, `_2`, ... to glTF node names that
  // collide globally (Kitchen_set's many `Geom` siblings, for example).
  // For USD-sourced nodes the SdfPath is globally unique, so derive the
  // display label from the SdfPath basename. Falls back to the raw
  // Three.js name for non-USD assets where primPath is absent.
  const displayName = primPath
    ? basenameFromPrimPath(primPath)
    : safeTrimmedName(object);
  return {
    name: displayName,
    kind: getObjectKind(object),
    children: collectHierarchyChildren(object),
    ...(primPath !== undefined ? { primPath } : {}),
  };
}

/** Build the children list of `parent`, inlining synthetic wrappers
 * (the children of a wrapper appear as direct children of `parent`).
 * Recursively flattens chains of wrappers in the rare case the GLB
 * pipeline ever stacks more than one. */
function collectHierarchyChildren(parent: Object3D): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  for (const child of parent.children) {
    if (isSyntheticWrapper(child)) {
      out.push(...collectHierarchyChildren(child));
    } else {
      out.push(buildHierarchyNode(child));
    }
  }
  return out;
}

/** Public entry: returns the user-visible hierarchy roots, skipping
 * past any chain of synthetic wrapper nodes at the top of the scene
 * graph so the first row the user sees is the actual USD stage root
 * (e.g. `Kitchen_set`) rather than `(unnamed) → __upAxis → Kitchen_set`. */
function buildHierarchyForest(root: Object3D): HierarchyNode[] {
  if (isSyntheticWrapper(root)) {
    return collectHierarchyChildren(root);
  }
  return [buildHierarchyNode(root)];
}

function getMaterialColor(material: Material): string | null {
  if (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhongMaterial ||
    material instanceof MeshBasicMaterial
  ) {
    return `#${material.color.getHexString()}`;
  }
  return null;
}

function countMaterialTextures(material: Material): number {
  const slots: TextureSlotKey[] = [
    "map",
    "normalMap",
    "metalnessMap",
    "roughnessMap",
    "emissiveMap",
    "alphaMap",
  ];
  let count = 0;
  for (const key of slots) {
    if ((material as TexturedMaterial)[key] instanceof Texture) {
      count += 1;
    }
  }
  return count;
}

/** Extract a `MaterialTextureSlot` from a Three.js `Texture`, falling back
 * to `slotLabel` when the texture has no meaningful name. Returns `null`
 * when `texture` is falsy. */
function textureSlot(
  texture: Texture | null | undefined,
  slotLabel: string,
): MaterialTextureSlot | null {
  if (!(texture instanceof Texture)) return null;
  const name =
    texture.name.trim() ||
    (typeof texture.userData?.path === "string" && texture.userData.path
      ? texture.userData.path
      : slotLabel);
  return { name };
}

/** Infer the glTF alpha mode from Three.js material flags. Prefers the
 * value stored in `material.userData.gltfAlphaMode` if the GLTFLoader
 * wrote it. Falls back to heuristics for non-glTF assets. */
function inferAlphaMode(
  material: Material,
): "OPAQUE" | "MASK" | "BLEND" | "unknown" {
  const ud = material.userData as Record<string, unknown>;
  if (
    ud.gltfAlphaMode === "OPAQUE" ||
    ud.gltfAlphaMode === "MASK" ||
    ud.gltfAlphaMode === "BLEND"
  ) {
    return ud.gltfAlphaMode as "OPAQUE" | "MASK" | "BLEND";
  }
  if (material.transparent) return "BLEND";
  if (material.alphaTest > 0) return "MASK";
  return "OPAQUE";
}

function buildMaterialEntry(
  material: Material,
  boundMeshes: string[],
): MaterialEntry {
  const typeName = material.type
    .replace("Material", "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

  // ── Per-type shader slot extraction ──────────────────────────────────
  let baseColorFactor: [number, number, number, number] | null = null;
  let metallicFactor: number | null = null;
  let roughnessFactor: number | null = null;
  let emissiveFactor: [number, number, number] | null = null;
  let baseColorTexture: MaterialTextureSlot | null = null;
  let metallicRoughnessTexture: MaterialTextureSlot | null = null;
  let normalTexture: MaterialTextureSlot | null = null;
  let emissiveTexture: MaterialTextureSlot | null = null;

  if (material instanceof MeshStandardMaterial) {
    const c = material.color;
    baseColorFactor = [c.r, c.g, c.b, material.opacity];
    metallicFactor = material.metalness;
    roughnessFactor = material.roughness;
    const e = material.emissive as Color;
    emissiveFactor = [e.r, e.g, e.b];
    baseColorTexture = textureSlot(material.map, "Base Color");
    metallicRoughnessTexture = textureSlot(
      material.metalnessMap,
      "Metallic-Roughness",
    );
    normalTexture = textureSlot(material.normalMap, "Normal");
    emissiveTexture = textureSlot(material.emissiveMap, "Emissive");
  } else if (material instanceof MeshPhongMaterial) {
    const c = material.color;
    baseColorFactor = [c.r, c.g, c.b, material.opacity];
    const e = material.emissive as Color;
    emissiveFactor = [e.r, e.g, e.b];
    baseColorTexture = textureSlot(material.map, "Base Color");
    normalTexture = textureSlot(material.normalMap, "Normal");
    emissiveTexture = textureSlot(material.emissiveMap, "Emissive");
  } else if (material instanceof MeshBasicMaterial) {
    const c = material.color;
    baseColorFactor = [c.r, c.g, c.b, material.opacity];
    baseColorTexture = textureSlot(material.map, "Base Color");
  }

  const ud = material.userData as Record<string, unknown>;
  const usdPrimPath =
    typeof ud.usdPrimPath === "string" && ud.usdPrimPath
      ? ud.usdPrimPath
      : null;

  return {
    id: material.uuid,
    name: material.name.trim() || typeName,
    type: typeName,
    color: getMaterialColor(material),
    opacity: material.opacity,
    transparent: material.transparent,
    textureCount: countMaterialTextures(material),
    boundMeshes,
    baseColorFactor,
    metallicFactor,
    roughnessFactor,
    emissiveFactor,
    baseColorTexture,
    metallicRoughnessTexture,
    normalTexture,
    emissiveTexture,
    alphaMode: inferAlphaMode(material),
    usdPrimPath,
  };
}

function getTextureDimensions(texture: Texture) {
  const image = texture.image as
    | { width?: number; height?: number }
    | undefined;

  if (
    image &&
    typeof image.width === "number" &&
    typeof image.height === "number"
  ) {
    return `${image.width}x${image.height}`;
  }

  return "unknown";
}

const THUMB_SIZE = 128;

function generateThumbnailUrl(texture: Texture): string | null {
  const image = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined;

  if (!image) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(image as CanvasImageSource, 0, 0, THUMB_SIZE, THUMB_SIZE);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

function inferTextureSourceKind(
  texture: Texture,
  currentFile: SelectedFile,
): AssetMetadata["textures"][number]["sourceKind"] {
  const fromUserData = texture.userData.textureSourceKind;
  if (
    fromUserData === "embedded" ||
    fromUserData === "external" ||
    fromUserData === "standalone"
  ) {
    return fromUserData;
  }

  if (currentFile.kind === "texture") {
    return "standalone";
  }

  if (currentFile.extension === "glb") {
    return "embedded";
  }

  if (currentFile.extension === "obj") {
    return "external";
  }

  return "unknown";
}

function buildLightEntry(light: Light): LightEntry {
  const colorHex =
    "color" in light && light.color
      ? `#${(light.color as { getHexString(): string }).getHexString()}`
      : null;
  const trimmed = safeTrimmedName(light);
  return {
    id: light.uuid,
    name: trimmed || light.type,
    type: light.type,
    color: colorHex,
    intensity: light.intensity,
  };
}

/**
 * Resolve the display name of a Camera for selection purposes.
 * Falls back to a sensible default when the camera is unnamed.
 * Note: #46 removed the `_camera_node` suffix from GLB node names,
 * so no stripping is needed for USD-sourced cameras.
 */
export function cameraDisplayName(camera: Camera): string {
  const trimmed = safeTrimmedName(camera);
  if (trimmed) return trimmed;
  if (camera instanceof PerspectiveCamera) return "PerspectiveCamera";
  if (camera instanceof OrthographicCamera) return "OrthographicCamera";
  return camera.type;
}

/**
 * Build the stable selection key for a Camera. Two cameras with the
 * same display name produce keys `Camera`, `Camera#1`, `Camera#2`, …
 * (the first occurrence keeps the bare name for backwards compatibility
 * with name-based selection from before #34 follow-up).
 *
 * Stable across reloads when the authored camera order is unchanged —
 * unlike Three.js `Object3D.uuid`, which gets minted fresh on every
 * load and would drop the user's selection on every variant change.
 *
 * Pass the same `seenCounts` Map to consecutive calls in traversal
 * order so the indices stay consistent between the metadata
 * collection pass and the viewport's selection-lookup pass.
 */
export function cameraSelectionKey(
  camera: Camera,
  seenCounts: Map<string, number>,
): string {
  const name = cameraDisplayName(camera);
  const seen = seenCounts.get(name) ?? 0;
  seenCounts.set(name, seen + 1);
  return seen === 0 ? name : `${name}#${seen}`;
}

function buildCameraEntry(
  camera: Camera,
  seenCounts: Map<string, number>,
): CameraEntry {
  const trimmed = safeTrimmedName(camera);
  const id = cameraSelectionKey(camera, seenCounts);
  if (camera instanceof PerspectiveCamera) {
    return {
      id,
      name: trimmed || "PerspectiveCamera",
      projection: "perspective",
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
    };
  }
  if (camera instanceof OrthographicCamera) {
    return {
      id,
      name: trimmed || "OrthographicCamera",
      projection: "orthographic",
      fov: null,
      aspect: null,
      near: camera.near,
      far: camera.far,
    };
  }
  return {
    id,
    name: trimmed || camera.type,
    projection: "perspective",
    fov: null,
    aspect: null,
    near: 0,
    far: 0,
  };
}

export function collectAssetMetadata(
  object: Group | Mesh,
  currentFile: SelectedFile,
  clips: AnimationClip[],
  formatVersion: string | null,
): MetadataCollection {
  let nodeCount = 0;
  let meshCount = 0;
  const materials = new Set<Material>();
  // Material → mesh-name list. Insertion-ordered so the UI shows binds
  // in scene-graph traversal order. A mesh that authors an array
  // material is registered once per array slot, matching the way USD
  // surfaces multiple bindings on a single Mesh prim.
  const materialBindings = new Map<Material, string[]>();
  const textures = new Map<string, AssetMetadata["textures"][number]>();
  const textureRegistry = new Map<string, Texture>();
  const lights: LightEntry[] = [];
  const cameras: CameraEntry[] = [];
  // Tracks camera-name occurrences during traversal so duplicate-named
  // cameras get suffixed selection ids (#1, #2, …).
  const cameraSeenCounts = new Map<string, number>();

  object.traverse((child: Object3D) => {
    nodeCount += 1;

    if (child instanceof Light) {
      lights.push(buildLightEntry(child));
      return;
    }

    if (child instanceof Camera) {
      cameras.push(buildCameraEntry(child, cameraSeenCounts));
      return;
    }

    if (!(child instanceof Mesh)) {
      return;
    }

    meshCount += 1;

    const meshName = safeTrimmedName(child) || "(unnamed mesh)";

    for (const material of getMaterials(child.material)) {
      materials.add(material);

      const existing = materialBindings.get(material);
      if (existing) {
        existing.push(meshName);
      } else {
        materialBindings.set(material, [meshName]);
      }

      const textureSlots = [
        ["Base Color", "map"],
        ["Normal", "normalMap"],
        ["Metalness", "metalnessMap"],
        ["Roughness", "roughnessMap"],
        ["Emissive", "emissiveMap"],
        ["Alpha", "alphaMap"],
      ] as const satisfies ReadonlyArray<readonly [string, TextureSlotKey]>;

      for (const [channel, key] of textureSlots) {
        const textureValue = (material as TexturedMaterial)[key];
        if (!(textureValue instanceof Texture)) {
          continue;
        }

        const textureId = String(textureValue.uuid);
        if (textures.has(textureId)) {
          continue;
        }

        textures.set(textureId, {
          id: textureId,
          label: textureValue.name.trim() || `${channel} Texture`,
          channel,
          dimensions: getTextureDimensions(textureValue),
          thumbnailUrl: generateThumbnailUrl(textureValue),
          sourceKind: inferTextureSourceKind(textureValue, currentFile),
        });
        textureRegistry.set(textureId, textureValue);
      }
    }
  });

  return {
    metadata: {
      formatLabel: currentFile.extension.toUpperCase(),
      formatVersion,
      nodeCount,
      meshCount,
      materialCount: materials.size,
      textureCount: textures.size,
      hasAnimation: clips.length > 0,
      hierarchy: buildHierarchyForest(object),
      textures: [...textures.values()],
      materials: [...materials].map((material) =>
        buildMaterialEntry(material, materialBindings.get(material) ?? []),
      ),
      lights,
      cameras,
    },
    textureRegistry,
  };
}

export function buildMissingReferenceMetadata(
  currentFile: SelectedFile,
  formatVersion: string | null,
  missingPaths: string[],
  unresolvedImages: string[],
): AssetMetadata {
  const textureEntries = unresolvedImages.map((path, index) => ({
    id: `unresolved:${path}:${index}`,
    label: path,
    channel: "Missing",
    dimensions: "unknown",
    thumbnailUrl: null,
    sourceKind: "unresolved" as const,
  }));

  return {
    formatLabel: currentFile.extension.toUpperCase(),
    formatVersion,
    nodeCount: 0,
    meshCount: 0,
    materialCount: 0,
    textureCount: textureEntries.length,
    hasAnimation: false,
    hierarchy: [],
    materials: [],
    lights: [],
    cameras: [],
    textures:
      textureEntries.length > 0
        ? textureEntries
        : missingPaths.map((path, index) => ({
            id: `missing:${path}:${index}`,
            label: path,
            channel: "Missing Resource",
            dimensions: "unknown",
            thumbnailUrl: null,
            sourceKind: "unresolved" as const,
          })),
  };
}
