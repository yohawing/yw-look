import {
  AnimationClip,
  Box3,
  Bone,
  Camera,
  Color,
  Euler,
  Group,
  InterpolateDiscrete,
  InterpolateLinear,
  InterpolateSmooth,
  Light,
  Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PropertyBinding,
  SkinnedMesh,
  Texture,
} from "three";
import type { SelectedFile } from "../lib/files";
import type {
  AssetMetadata,
  CameraEntry,
  ObjectInfo,
  HierarchyNode,
  LightEntry,
  MaterialEntry,
  MaterialTextureSlot,
  MmdAssetMetadata,
  MmdBoneEntry,
  MmdMaterialEntry,
  MmdMorphEntry,
} from "../types/viewer";
import { isInternalMmdProxyObject } from "../packs";
import type { TextureSlotKey, TexturedMaterial } from "./types";
import {
  isViewportHelperObject,
  getMaterials,
  type SceneTraversalSnapshot,
} from "./scene";
import {
  explicitObjectSelectionKey,
  resolveObjectSelectionKey,
} from "./selectionKeys";

import type {
  AnimationClipMetadata,
  AnimationTrackMetadata,
  MetadataCollection,
} from "../types/viewer";

export type { MetadataCollection } from "../types/viewer";

function getObjectKind(object: Object3D) {
  if (object instanceof Mesh) {
    return "mesh";
  }

  if (object instanceof Group) {
    return "group";
  }

  return object.type.toLowerCase();
}

function fallbackTrackNameParts(name: string): {
  target: string;
  propertyPath: string;
} {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex >= name.length - 1) {
    return {
      target: name || "(unknown target)",
      propertyPath: "(unknown property)",
    };
  }

  return {
    target: name.slice(0, dotIndex) || "(unknown target)",
    propertyPath: name.slice(dotIndex + 1) || "(unknown property)",
  };
}

function parseAnimationTrackName(name: string): {
  target: string;
  propertyPath: string;
} {
  try {
    const parsed = PropertyBinding.parseTrackName(name);
    const objectSegment = parsed.objectName
      ? `${parsed.objectName}${parsed.objectIndex ? `[${parsed.objectIndex}]` : ""}`
      : "";
    const propertySegment = parsed.propertyName
      ? `${parsed.propertyName}${parsed.propertyIndex ? `[${parsed.propertyIndex}]` : ""}`
      : "";
    const propertyPath = [objectSegment, propertySegment]
      .filter(Boolean)
      .join(".");
    const target =
      parsed.objectName === "bones" && parsed.objectIndex
        ? parsed.objectIndex
        : parsed.nodeName || "(root)";

    return {
      target,
      propertyPath: propertyPath || "(unknown property)",
    };
  } catch {
    return fallbackTrackNameParts(name);
  }
}

function interpolationLabel(
  interpolation: number,
): AnimationTrackMetadata["interpolation"] {
  switch (interpolation) {
    case InterpolateLinear:
      return "linear";
    case InterpolateDiscrete:
      return "discrete";
    case InterpolateSmooth:
      return "smooth";
    default:
      return "unknown";
  }
}

function timeRange(times: ArrayLike<number>): [number, number] {
  if (times.length === 0) {
    return [0, 0];
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const time = times[i];
    if (!Number.isFinite(time)) continue;
    min = Math.min(min, time);
    max = Math.max(max, time);
  }

  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : [0, 0];
}

function estimateFrameRateFromDeltas(deltas: number[]): number | null {
  if (deltas.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const delta of deltas) {
    if (!Number.isFinite(delta) || delta <= Number.EPSILON) continue;
    const key = delta.toFixed(6);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let modeDelta = 0;
  let modeCount = 0;
  for (const [key, count] of counts) {
    if (count > modeCount) {
      modeDelta = Number(key);
      modeCount = count;
    }
  }

  return modeDelta > 0 ? 1 / modeDelta : null;
}

export function buildAnimationClipMetadata(
  clips: AnimationClip[],
): AnimationClipMetadata[] {
  return clips.map((clip, clipIndex) => {
    const deltas: number[] = [];
    const tracks = clip.tracks.map((track) => {
      const times = track.times;
      for (let i = 1; i < times.length; i += 1) {
        deltas.push(times[i] - times[i - 1]);
      }

      const parsedName = parseAnimationTrackName(track.name);
      return {
        name: track.name,
        target: parsedName.target,
        propertyPath: parsedName.propertyPath,
        keyframeCount: times.length,
        timeRange: timeRange(times),
        interpolation: interpolationLabel(track.getInterpolation()),
      };
    });

    return {
      name: clip.name.trim() || `Clip ${clipIndex + 1}`,
      duration: clip.duration,
      trackCount: tracks.length,
      keyframeCount: tracks.reduce(
        (sum, track) => sum + track.keyframeCount,
        0,
      ),
      estimatedFrameRate: estimateFrameRateFromDeltas(deltas),
      tracks,
    };
  });
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

/** True for nodes that loaders insert internally
 * and that should never appear in the user-facing hierarchy. The
 * predicate is intentionally narrow so non-USD formats (DAE, OBJ, …)
 * with their own legitimate unnamed groups are unaffected:
 *  - `__upAxis`: synthetic Z→Y correction wrapper (#46)
 *  - GLTFLoader's outer scene root, but ONLY when it is the parent of
 *    a `__upAxis` node — that pairing uniquely identifies our pipeline
 *    and avoids collapsing genuine unnamed Groups produced by other
 *    loaders (ColladaLoader, GLTFLoader for non-yw-look glTF, …)
 *  - MMD outline / render-order proxy meshes from three-mmd-loader. */
function isSyntheticWrapper(object: Object3D): boolean {
  if (isViewportHelperObject(object)) return true;
  if (isInternalMmdProxyObject(object)) return true;
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
  // `Ill-formed SdfPath` warnings when the USD backend tries to
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
  const explicitSelectionKey = explicitObjectSelectionKey(object);
  const mmdBoneName =
    object instanceof Bone ? stringValue(object.userData.mmdBoneName) : null;
  const nodeName = explicitSelectionKey ?? displayName;
  const visibleName = mmdBoneName ?? displayName;
  return {
    name: nodeName,
    ...(visibleName && visibleName !== nodeName
      ? { displayName: visibleName }
      : {}),
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

function textureFileName(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").split(/[?#]/, 1)[0];
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (!basename) return value.trim();
  try {
    return decodeURIComponent(basename);
  } catch {
    return basename;
  }
}

function textureSourceReference(
  texture: Texture,
  material: Material,
  slot: TextureSlotKey,
  channel: string,
  currentFile: SelectedFile,
): string | null {
  const genericName = `${channel} Texture`;
  const userData = texture.userData as Record<string, unknown>;
  const sourcePath =
    stringValue(userData.path) ??
    stringValue(userData.fbxSourceName) ??
    stringValue(userData.sourcePath) ??
    stringValue(userData.uri);
  if (sourcePath) return sourcePath;

  const mmd = buildMmdMaterialEntry(material);
  const mmdPath = slot === "map" ? mmd?.texturePath : null;
  if (mmdPath) return mmdPath;

  if (currentFile.kind === "texture") {
    return currentFile.path;
  }

  const textureName = stringValue(texture.name);
  return textureName && textureName !== genericName ? textureName : null;
}

function textureDisplayName(
  texture: Texture,
  material: Material,
  slot: TextureSlotKey,
  channel: string,
  currentFile: SelectedFile,
): string {
  const sourceReference = textureSourceReference(
    texture,
    material,
    slot,
    channel,
    currentFile,
  );
  return sourceReference
    ? textureFileName(sourceReference)
    : `${channel} Texture`;
}

function textureSourceKey(sourceReference: string, channel: string): string {
  const normalized = sourceReference
    .trim()
    .replace(/\\/g, "/")
    .split(/[?#]/, 1)[0];
  return `${channel}:${normalized}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberTuple3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const tuple = value.slice(0, 3).map(numberValue);
  if (tuple.some((v) => v === null)) return null;
  return tuple as [number, number, number];
}

function numberTuple4(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const tuple = value.slice(0, 4).map(numberValue);
  if (tuple.some((v) => v === null)) return null;
  return tuple as [number, number, number, number];
}

function booleanRecord(value: unknown): Record<string, boolean> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function buildMmdMaterialEntry(material: Material): MmdMaterialEntry | null {
  const raw = (material.userData as Record<string, unknown>).mmdMaterial;
  if (!isRecord(raw)) return null;

  const name = stringValue(raw.name);
  if (!name) return null;

  return {
    materialIndex: numberValue(raw.materialIndex),
    name,
    englishName: stringValue(raw.englishName),
    diffuse: numberTuple4(raw.diffuse),
    specular: numberTuple3(raw.specular),
    ambient: numberTuple3(raw.ambient),
    specularPower: numberValue(raw.specularPower),
    edgeColor: numberTuple4(raw.edgeColor),
    edgeSize: numberValue(raw.edgeSize),
    texturePath: stringValue(raw.texturePath),
    sphereTexturePath: stringValue(raw.sphereTexturePath),
    sphereMode: stringValue(raw.sphereMode),
    toonTexturePath: stringValue(raw.toonTexturePath),
    sharedToonIndex: numberValue(raw.sharedToonIndex),
    transparencyMode: stringValue(raw.transparencyMode),
    renderOrderBucket: stringValue(raw.renderOrderBucket),
    faceCount: numberValue(raw.faceCount),
    flags: booleanRecord(raw.flags),
    unsupportedDrawFlags: stringArray(raw.unsupportedDrawFlags),
  };
}

function materialDisplayName(material: Material, fallbackType: string): string {
  const mmd = buildMmdMaterialEntry(material);
  if (mmd?.name) return mmd.name;
  const trimmed = typeof material.name === "string" ? material.name.trim() : "";
  return trimmed || fallbackType;
}

function boneDisplayName(bone: Bone): string {
  return (
    stringValue(bone.userData.mmdBoneName) ??
    (typeof bone.name === "string" && bone.name.trim()
      ? bone.name.trim()
      : null) ??
    "Bone"
  );
}

function buildMmdBoneMetadata(
  root: Object3D,
  objects?: readonly Object3D[],
): Map<Bone, MmdBoneEntry> {
  const entries = new Map<Bone, MmdBoneEntry>();

  const visit = (object: Object3D) => {
    if (!(object instanceof SkinnedMesh) || !object.skeleton) return;
    if (isSyntheticWrapper(object)) return;
    const bones = object.skeleton.bones;
    const ikChains = Array.isArray(object.userData.mmdIkChains)
      ? object.userData.mmdIkChains.filter(isRecord)
      : [];

    bones.forEach((bone, boneIndex) => {
      const parentIndex =
        bone.parent instanceof Bone ? bones.indexOf(bone.parent) : -1;
      const appendTransform = buildMmdBoneAppendTransform(
        bone.userData.mmdAppendTransform,
        bones,
      );
      const name = stringValue(bone.userData.mmdBoneName);
      const englishName = stringValue(bone.userData.mmdEnglishBoneName);
      const restPosition = numberTuple3(bone.userData.mmdRestPosition);
      const layer = numberValue(bone.userData.mmdLayer);
      const flags = booleanRecord(bone.userData.mmdFlags);
      const ik = buildMmdBoneIkSummary(boneIndex, ikChains);

      if (
        name === null &&
        englishName === null &&
        restPosition === null &&
        layer === null &&
        appendTransform === null &&
        flags === null &&
        ik === null
      ) {
        return;
      }

      entries.set(bone, {
        boneIndex,
        parentIndex,
        parentName:
          parentIndex >= 0 && bones[parentIndex]
            ? boneDisplayName(bones[parentIndex])
            : null,
        name,
        englishName,
        restPosition,
        layer,
        appendTransform,
        flags,
        ik,
      });
    });
  };
  if (objects) {
    for (const object of objects) visit(object);
  } else {
    root.traverse(visit);
  }

  return entries;
}

function buildMmdBoneAppendTransform(
  value: unknown,
  bones: readonly Bone[],
): MmdBoneEntry["appendTransform"] {
  if (!isRecord(value)) return null;
  const parentIndex = numberValue(value.parentIndex);
  const weight = numberValue(value.weight);
  if (parentIndex === null || weight === null) return null;
  return {
    parentIndex,
    parentName:
      parentIndex >= 0 && bones[parentIndex]
        ? boneDisplayName(bones[parentIndex])
        : null,
    weight,
  };
}

function buildMmdBoneIkSummary(
  boneIndex: number,
  chains: readonly Record<string, unknown>[],
): MmdBoneEntry["ik"] {
  const roles = new Set<string>();
  let selectedChain: Record<string, unknown> | null = null;

  for (const chain of chains) {
    const goalBoneIndex = numberValue(chain.goalBoneIndex);
    const effectorBoneIndex = numberValue(chain.effectorBoneIndex);
    const links = Array.isArray(chain.links)
      ? chain.links.filter(isRecord)
      : [];

    if (goalBoneIndex === boneIndex) {
      roles.add("goal");
      selectedChain ??= chain;
    }
    if (effectorBoneIndex === boneIndex) {
      roles.add("effector");
      selectedChain ??= chain;
    }
    if (links.some((link) => numberValue(link.boneIndex) === boneIndex)) {
      roles.add("link");
      selectedChain ??= chain;
    }
  }

  if (roles.size === 0 || selectedChain === null) return null;

  const links = Array.isArray(selectedChain.links)
    ? selectedChain.links.filter(isRecord)
    : [];
  const limitKinds = [
    ...new Set(
      links
        .map((link) => stringValue(link.limitsKind))
        .filter((value): value is string => value !== null),
    ),
  ];

  return {
    roles: [...roles],
    goalBoneIndex: numberValue(selectedChain.goalBoneIndex),
    effectorBoneIndex: numberValue(selectedChain.effectorBoneIndex),
    iterationCount: numberValue(selectedChain.iterationCount),
    maxAnglePerIteration: numberValue(selectedChain.maxAnglePerIteration),
    linkCount: links.length,
    limitKinds,
  };
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildMmdMorphEntry(value: unknown): MmdMorphEntry | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name);
  const englishName = stringValue(value.englishName);
  const type = stringValue(value.type);
  if (name === null && englishName === null && type === null) return null;
  return {
    name,
    englishName,
    type,
    boneOffsetCount: countArray(value.boneOffsets),
    groupOffsetCount: countArray(value.groupOffsets),
    flipOffsetCount: countArray(value.flipOffsets),
    impulseOffsetCount: countArray(value.impulseOffsets),
  };
}

function mmdMorphsByIndex(object: Mesh): Map<number, MmdMorphEntry> {
  const values = Array.isArray(object.userData.mmdMorphs)
    ? object.userData.mmdMorphs
    : [];
  const out = new Map<number, MmdMorphEntry>();
  values.forEach((value, index) => {
    const entry = buildMmdMorphEntry(value);
    if (entry) out.set(index, entry);
  });
  return out;
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
  const mmd = buildMmdMaterialEntry(material);

  return {
    id: material.uuid,
    name: mmd?.name ?? (material.name.trim() || typeName),
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
    mmd,
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
const DEFAULT_THUMBNAIL_CHUNK_SIZE = 4;

type ScheduledTextureThumbnailEnrichment = {
  cancel: () => void;
  refresh: () => void;
};

type TextureThumbnailTaskScheduler = (callback: () => void) => () => void;

type ScheduleTextureThumbnailEnrichmentOptions = {
  chunkSize?: number;
  metadata: AssetMetadata;
  onUpdate: (metadata: AssetMetadata) => void;
  scheduleTask?: TextureThumbnailTaskScheduler;
  shouldContinue?: () => boolean;
  textureRegistry: ReadonlyMap<string, Texture>;
};

function shouldFlipTexturePreviewY(
  texture: Texture,
  currentFile: SelectedFile,
): boolean {
  return (
    (currentFile.extension === "pmx" || currentFile.extension === "pmd") &&
    texture.flipY === false
  );
}

function drawRawTextureImage(
  targetContext: CanvasRenderingContext2D,
  image: { data: unknown; height: number; width: number },
): boolean {
  const { data, height, width } = image;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray))
  ) {
    return false;
  }

  const pixelCount = width * height;
  if (data.length !== pixelCount * 4 && data.length !== pixelCount * 3) {
    return false;
  }

  const rgba = new Uint8ClampedArray(pixelCount * 4);
  if (data.length === pixelCount * 4) {
    rgba.set(data);
  } else {
    for (let source = 0, target = 0; source < data.length; source += 3) {
      rgba[target++] = data[source];
      rgba[target++] = data[source + 1];
      rgba[target++] = data[source + 2];
      rgba[target++] = 255;
    }
  }

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) return false;

  const imageData = sourceContext.createImageData(width, height);
  imageData.data.set(rgba);
  sourceContext.putImageData(imageData, 0, 0);
  targetContext.drawImage(sourceCanvas, 0, 0, THUMB_SIZE, THUMB_SIZE);
  return true;
}

function generateThumbnailUrl(texture: Texture): string | null {
  const image = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | { data: unknown; height: number; width: number }
    | undefined;

  if (!image) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const isRawImage =
      typeof image === "object" &&
      image !== null &&
      "data" in image &&
      "width" in image &&
      "height" in image;
    if (isRawImage) {
      if (!drawRawTextureImage(ctx, image)) return null;
    } else {
      ctx.drawImage(image as CanvasImageSource, 0, 0, THUMB_SIZE, THUMB_SIZE);
    }
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

type TextureThumbnailRevision = {
  image: unknown;
  width: number | undefined;
  height: number | undefined;
  data: unknown;
  mipmaps: unknown;
};

function getTextureThumbnailRevision(
  texture: Texture,
): TextureThumbnailRevision {
  const image = texture.image as
    | {
        width?: number;
        height?: number;
        data?: unknown;
        mipmaps?: unknown;
      }
    | undefined;
  return {
    image,
    width: image?.width,
    height: image?.height,
    data: image?.data,
    mipmaps: image?.mipmaps,
  };
}

function sameTextureThumbnailRevision(
  left: TextureThumbnailRevision,
  right: TextureThumbnailRevision,
): boolean {
  return (
    left.image === right.image &&
    left.width === right.width &&
    left.height === right.height &&
    left.data === right.data &&
    left.mipmaps === right.mipmaps
  );
}

function scheduleIdleTask(callback: () => void): () => void {
  const maybeWindow =
    typeof window === "undefined"
      ? null
      : (window as Window & {
          cancelIdleCallback?: (handle: number) => void;
          requestIdleCallback?: (callback: () => void) => number;
        });

  if (maybeWindow?.requestIdleCallback && maybeWindow.cancelIdleCallback) {
    const handle = maybeWindow.requestIdleCallback(callback);
    return () => maybeWindow.cancelIdleCallback?.(handle);
  }

  const handle = globalThis.setTimeout(callback, 16);
  return () => globalThis.clearTimeout(handle);
}

export function scheduleTextureThumbnailEnrichment({
  chunkSize = DEFAULT_THUMBNAIL_CHUNK_SIZE,
  metadata,
  onUpdate,
  scheduleTask = scheduleIdleTask,
  shouldContinue = () => true,
  textureRegistry,
}: ScheduleTextureThumbnailEnrichmentOptions): ScheduledTextureThumbnailEnrichment {
  if (metadata.textures.length === 0 || textureRegistry.size === 0) {
    return { cancel: () => {}, refresh: () => {} };
  }

  let cancelled = false;
  let cancelScheduledTask: (() => void) | null = null;
  let textureIndex = 0;
  let currentMetadata = metadata;
  let currentTextures = metadata.textures;
  const thumbnailRevisions = new Map<string, TextureThumbnailRevision>();
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));
  const canContinue = () => !cancelled && shouldContinue();

  const refresh = () => {
    if (!canContinue()) return;
    textureIndex = 0;
    if (!cancelScheduledTask) {
      scheduleNext();
    }
  };

  const scheduleNext = () => {
    cancelScheduledTask = scheduleTask(runChunk);
  };

  const runChunk = () => {
    cancelScheduledTask = null;
    if (!canContinue()) return;

    let nextTextures = currentTextures;
    let changed = false;
    let processed = 0;

    while (
      textureIndex < currentTextures.length &&
      processed < safeChunkSize &&
      canContinue()
    ) {
      const index = textureIndex;
      const entry = currentTextures[index];
      textureIndex += 1;
      processed += 1;

      const texture = textureRegistry.get(entry.id);
      if (!texture) continue;

      const revision = getTextureThumbnailRevision(texture);
      const previousRevision = thumbnailRevisions.get(entry.id);
      if (
        entry.thumbnailUrl &&
        (!previousRevision ||
          sameTextureThumbnailRevision(previousRevision, revision))
      ) {
        continue;
      }

      const thumbnailUrl = generateThumbnailUrl(texture);
      if (!thumbnailUrl) continue;

      if (nextTextures === currentTextures) {
        nextTextures = [...currentTextures];
      }
      nextTextures[index] = { ...entry, thumbnailUrl };
      thumbnailRevisions.set(entry.id, revision);
      changed = true;
    }

    if (changed && canContinue()) {
      currentTextures = nextTextures;
      currentMetadata = { ...currentMetadata, textures: currentTextures };
      onUpdate(currentMetadata);
    }

    if (textureIndex < currentTextures.length && canContinue()) {
      scheduleNext();
    }
  };

  scheduleNext();

  return {
    cancel: () => {
      cancelled = true;
      cancelScheduledTask?.();
      cancelScheduledTask = null;
    },
    refresh,
  };
}

function inferTextureSourceKind(
  texture: Texture,
  currentFile: SelectedFile,
): AssetMetadata["textures"][number]["sourceKind"] {
  const fromUserData = texture.userData.textureSourceKind;
  if (
    fromUserData === "embedded" ||
    fromUserData === "external" ||
    fromUserData === "standalone" ||
    fromUserData === "unresolved"
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

/** Resolve the stable selection key for an Object3D, matching the logic
 * in both AssetViewport picking and highlight.ts.  Prefers
 * `userData.primPath` for USD-sourced nodes; falls back to the
 * trimmed `Object3D.name` for non-USD assets.  Returns `null` for
 * unnamed meshes / groups that cannot be meaningfully selected. */
function resolveSelectionKey(object: Object3D): string | null {
  return resolveObjectSelectionKey(object);
}

/** Build an `ObjectInfo` entry for one traversed Object3D.  Handles
 * Meshes (with geometry stats and material refs), Groups (with child
 * count), and other node types by falling back to sensible defaults. */
function buildObjectInfo(
  object: Object3D,
  clips: AnimationClip[],
  key: string,
  mmdBoneMetadata: Map<Bone, MmdBoneEntry>,
): ObjectInfo {
  const p = object.position;
  const e = new Euler().setFromQuaternion(object.quaternion, "YXZ");
  const s = object.scale;

  let bbox: ObjectInfo["boundingBox"] = null;
  let vertexCount: number | null = null;
  let triangleCount: number | null = null;
  let materialNames: string[] = [];
  let materialIds: string[] = [];
  let morphTargets: ObjectInfo["morphTargets"] = [];
  let childCount: number | null = null;

  if (object instanceof Mesh) {
    // Bbox from mesh geometry only — avoids O(N²) when called on
    // Group nodes inside `object.traverse()` (#80 codex-review).
    try {
      const box = new Box3().setFromObject(object);
      if (!box.isEmpty()) {
        bbox = [
          box.min.x,
          box.min.y,
          box.min.z,
          box.max.x,
          box.max.y,
          box.max.z,
        ];
      }
    } catch {
      /* degenerate geometry — leave null */
    }

    const geom = object.geometry;
    if (geom) {
      vertexCount = geom.attributes.position?.count ?? null;
      if (geom.index) {
        triangleCount = Math.round(geom.index.count / 3);
      } else if (vertexCount) {
        triangleCount = Math.round(vertexCount / 3);
      }
    }
    const mats = getMaterials(object.material);
    materialNames = mats.map((m) => materialDisplayName(m, m.type));
    materialIds = mats.map((m) => m.uuid);

    const influences = object.morphTargetInfluences ?? [];
    const dictionary = object.morphTargetDictionary ?? {};
    const mmdMorphs = mmdMorphsByIndex(object);
    const namesByIndex = new Map<number, string>();
    for (const [name, index] of Object.entries(dictionary)) {
      if (Number.isInteger(index) && index >= 0) {
        namesByIndex.set(index, name);
      }
    }
    morphTargets = influences.map((value, index) => {
      const mmd = mmdMorphs.get(index) ?? null;
      return {
        index,
        name: mmd?.name ?? namesByIndex.get(index) ?? `Target ${index + 1}`,
        value,
        mmd,
      };
    });
  } else if (object instanceof Group) {
    childCount = object.children.length;
  }

  const clipNames: string[] = [];
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const targetName = track.name.split(".")[0];
      if (targetName === key || targetName === object.name) {
        clipNames.push(clip.name || `Clip ${clipNames.length}`);
        break;
      }
    }
  }

  // Surface userData fields while filtering out internal sentinel keys
  const userKeys = Object.keys(object.userData).filter(
    (k) =>
      !k.startsWith("__") &&
      !k.startsWith("mmd") &&
      k !== "vrm" &&
      k !== "primPath" &&
      k !== "purpose" &&
      k !== "textureSourceKind",
  );
  const userData =
    userKeys.length > 0
      ? (Object.fromEntries(
          userKeys.map((k) => [k, object.userData[k]]),
        ) as Record<string, unknown>)
      : null;

  const kind = getObjectKind(object);

  return {
    name: safeTrimmedName(object) || kind,
    kind,
    visible: object.visible,
    position: [p.x, p.y, p.z],
    rotation: [
      MathUtils.radToDeg(e.x),
      MathUtils.radToDeg(e.y),
      MathUtils.radToDeg(e.z),
    ],
    scale: [s.x, s.y, s.z],
    boundingBox: bbox,
    vertexCount,
    triangleCount,
    materialNames,
    materialIds,
    morphTargets,
    childCount,
    animatesWithClips: clipNames,
    userData,
    mmdBone:
      object instanceof Bone ? (mmdBoneMetadata.get(object) ?? null) : null,
  };
}

export function collectAssetMetadata(
  object: Group | Mesh,
  currentFile: SelectedFile,
  clips: AnimationClip[],
  formatVersion: string | null,
  mmdMetadata?: MmdAssetMetadata,
  traversal?: Pick<SceneTraversalSnapshot, "objects">,
): MetadataCollection {
  let nodeCount = 0;
  let meshCount = 0;
  let boneCount = 0;
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
  const animationClips = buildAnimationClipMetadata(clips);
  // Tracks camera-name occurrences during traversal so duplicate-named
  // cameras get suffixed selection ids (#1, #2, …).
  const cameraSeenCounts = new Map<string, number>();
  // Selection key → per-object info for the shared inspector (#80)
  const objectInfoMap = new Map<string, ObjectInfo>();
  const mmdBoneMetadata = buildMmdBoneMetadata(object, traversal?.objects);

  const visit = (child: Object3D) => {
    if (isSyntheticWrapper(child)) return;
    nodeCount += 1;
    if (child instanceof Bone) {
      boneCount += 1;
    }

    // Collect ObjectInfo for every traversed node that has a stable
    // selection key (meshes, named groups, lights, cameras).
    const infoKey = resolveSelectionKey(child);
    if (infoKey) {
      objectInfoMap.set(
        infoKey,
        buildObjectInfo(child, clips, infoKey, mmdBoneMetadata),
      );
    }

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
        const sourceReference = textureSourceReference(
          textureValue,
          material,
          key,
          channel,
          currentFile,
        );
        const textureKey = sourceReference
          ? textureSourceKey(sourceReference, channel)
          : `uuid:${textureId}`;
        if (textures.has(textureKey)) {
          continue;
        }

        const previewFlipY = shouldFlipTexturePreviewY(
          textureValue,
          currentFile,
        );
        textures.set(textureKey, {
          id: textureId,
          label: textureDisplayName(
            textureValue,
            material,
            key,
            channel,
            currentFile,
          ),
          ...(sourceReference ? { sourcePath: sourceReference } : {}),
          channel,
          dimensions: getTextureDimensions(textureValue),
          thumbnailUrl: null,
          ...(previewFlipY ? { previewFlipY } : {}),
          sourceKind: inferTextureSourceKind(textureValue, currentFile),
        });
        textureRegistry.set(textureId, textureValue);
      }
    }
  };
  if (traversal) {
    for (const child of traversal.objects) visit(child);
  } else {
    object.traverse(visit);
  }

  return {
    metadata: {
      formatLabel: currentFile.extension.toUpperCase(),
      formatVersion,
      nodeCount,
      meshCount,
      boneCount,
      hasBones: boneCount > 0,
      materialCount: materials.size,
      textureCount: textures.size,
      hasAnimation: clips.length > 0,
      animationClips,
      hierarchy: buildHierarchyForest(object),
      textures: [...textures.values()],
      materials: [...materials].map((material) =>
        buildMaterialEntry(material, materialBindings.get(material) ?? []),
      ),
      lights,
      cameras,
      objectInfo: Object.fromEntries(objectInfoMap),
      ...(mmdMetadata ? { mmd: mmdMetadata } : {}),
    },
    textureRegistry,
  };
}

export function refreshTextureSourceKinds(
  metadata: AssetMetadata,
  currentFile: SelectedFile,
  textureRegistry: ReadonlyMap<string, Texture>,
): AssetMetadata {
  let changed = false;
  const textures = metadata.textures.map((entry) => {
    const texture = textureRegistry.get(entry.id);
    if (!texture) return entry;
    const sourceKind = inferTextureSourceKind(texture, currentFile);
    if (sourceKind === entry.sourceKind) return entry;
    changed = true;
    return { ...entry, sourceKind };
  });
  return changed ? { ...metadata, textures } : metadata;
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
    sourcePath: path,
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
    objectInfo: {},
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
