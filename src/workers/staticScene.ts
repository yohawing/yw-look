import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  SkinnedMesh,
  Texture,
  type Material,
} from "three";

const SERIALIZABLE_TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
] as const;

type SerializableTextureSlot = (typeof SERIALIZABLE_TEXTURE_SLOTS)[number];

/** Shared sampler/transform fields for both ImageData and deferred textures. */
export type ModelParseWorkerStaticTextureSamplerPayload = {
  name?: string;
  userData?: Record<string, unknown>;
  colorSpace: Texture["colorSpace"];
  flipY: boolean;
  wrapS: Texture["wrapS"];
  wrapT: Texture["wrapT"];
  magFilter: Texture["magFilter"];
  minFilter: Texture["minFilter"];
  mapping: Texture["mapping"];
  anisotropy: number;
  offset: [number, number];
  repeat: [number, number];
  center: [number, number];
  rotation: number;
};

/**
 * Baked pixel texture (glTF/GLB ImageData path).
 * Main-thread reconstruction builds a Texture with an ImageData image.
 */
export type ModelParseWorkerStaticTextureImagePayload =
  ModelParseWorkerStaticTextureSamplerPayload & {
    kind: "imageData";
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };

/**
 * Worker-safe deferred FBX texture placeholder.
 * Records a relative source reference for main-thread hydration via
 * `createFbxLoadingManager().loadDeferredTexture`.
 */
export type ModelParseWorkerStaticTextureDeferredPayload =
  ModelParseWorkerStaticTextureSamplerPayload & {
    kind: "deferred";
    fbxSourceName: string;
  };

export type ModelParseWorkerStaticTexturePayload =
  | ModelParseWorkerStaticTextureImagePayload
  | ModelParseWorkerStaticTextureDeferredPayload;

export function isDeferredStaticTexturePayload(
  payload: ModelParseWorkerStaticTexturePayload,
): payload is ModelParseWorkerStaticTextureDeferredPayload {
  return payload.kind === "deferred";
}

export function isImageDataStaticTexturePayload(
  payload: ModelParseWorkerStaticTexturePayload,
): payload is ModelParseWorkerStaticTextureImagePayload {
  return payload.kind === "imageData";
}

export type ModelParseWorkerAttributeArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array;

export type ModelParseWorkerAttributePayload = {
  itemSize: number;
  normalized: boolean;
  array: ModelParseWorkerAttributeArray;
};

export type ModelParseWorkerStaticGeometryPayload = {
  attributes: Record<string, ModelParseWorkerAttributePayload>;
  index: ModelParseWorkerAttributePayload | null;
  groups: Array<{ start: number; count: number; materialIndex?: number }>;
};

export type ModelParseWorkerStaticMaterialType =
  | "MeshStandardMaterial"
  | "MeshPhongMaterial"
  | "MeshLambertMaterial"
  | "MeshBasicMaterial";

export type ModelParseWorkerStaticMaterialPayload = {
  type: ModelParseWorkerStaticMaterialType;
  name: string;
  userData?: Record<string, unknown>;
  color: number;
  metalness: number;
  roughness: number;
  opacity: number;
  transparent: boolean;
  vertexColors?: boolean;
  flatShading?: boolean;
  side: Material["side"];
  textures?: Partial<
    Record<SerializableTextureSlot, ModelParseWorkerStaticTexturePayload>
  >;
  /** Resource-table references used by the current transfer format. */
  textureIds?: Partial<Record<SerializableTextureSlot, number>>;
};

export type CanSerializeStaticNodeOptions = {
  requireSerializableTextures?: boolean;
};

export type ModelParseWorkerMeshPayload = {
  name: string;
  matrix: number[];
  userData: Record<string, unknown>;
  attributes: ModelParseWorkerStaticGeometryPayload["attributes"];
  index: ModelParseWorkerStaticGeometryPayload["index"];
  groups: ModelParseWorkerStaticGeometryPayload["groups"];
  material:
    | ModelParseWorkerStaticMaterialPayload
    | ModelParseWorkerStaticMaterialPayload[];
  /** Resource-table references. The inline fields remain for old consumers. */
  geometryId?: number;
  materialId?: number | number[];
};

export type ModelParseWorkerStaticNodePayload = {
  type: "Group" | "Mesh" | "LineSegments" | "Points" | "Object3D";
  name: string;
  matrix: number[];
  children: ModelParseWorkerStaticNodePayload[];
  geometry?: ModelParseWorkerStaticGeometryPayload;
  geometryId?: number;
  material?:
    | ModelParseWorkerStaticMaterialPayload
    | ModelParseWorkerStaticMaterialPayload[];
  materialId?: number | number[];
  visible?: boolean;
  userData?: Record<string, unknown>;
};

export type ModelParseWorkerStaticSceneResources = {
  geometries: ModelParseWorkerStaticGeometryPayload[];
  materials: ModelParseWorkerStaticMaterialPayload[];
  textures: ModelParseWorkerStaticTexturePayload[];
};

export type StaticScenePayloadBudget = {
  maxNodes?: number;
  maxGeometryCount?: number;
  maxVertexBytes?: number;
  maxIndexBytes?: number;
  maxTextureDecodedBytes?: number;
};

export type StaticScenePayloadBudgetUsage = {
  nodeCount: number;
  geometryCount: number;
  vertexBytes: number;
  indexBytes: number;
  textureDecodedBytes: number;
};

export type StaticScenePayloadBudgetReason =
  | "nodeCount"
  | "geometryCount"
  | "vertexBytes"
  | "indexBytes"
  | "textureDecodedBytes"
  | "unsafeInteger"
  | "invalidBudget";

export type StaticScenePayloadBudgetCheck =
  | { ok: true; usage: StaticScenePayloadBudgetUsage }
  | {
      ok: false;
      reason: StaticScenePayloadBudgetReason;
      usage: StaticScenePayloadBudgetUsage;
      limit?: number;
    };

export class StaticScenePayloadBudgetError extends Error {
  readonly code = "staticSceneBudgetExceeded";

  constructor(
    readonly reason: StaticScenePayloadBudgetReason,
    readonly usage: StaticScenePayloadBudgetUsage,
    readonly limit?: number,
  ) {
    super(
      reason === "invalidBudget"
        ? "Static scene budget contains an invalid limit."
        : `Static scene ${reason} budget exceeded before reconstruction.`,
    );
    this.name = "StaticScenePayloadBudgetError";
  }
}

export type ModelParseWorkerStaticScenePayload = {
  rootKind: "group" | "mesh";
  rootName: string;
  rootUserData: Record<string, unknown>;
  root?: ModelParseWorkerStaticNodePayload;
  meshes: ModelParseWorkerMeshPayload[];
  /** Deduplicated resources for worker transfer and main-thread restoration. */
  resources?: ModelParseWorkerStaticSceneResources;
};

function cloneAttribute(attribute: BufferAttribute) {
  return {
    itemSize: attribute.itemSize,
    normalized: attribute.normalized,
    array: attribute.array.slice(0) as ModelParseWorkerAttributeArray,
  };
}

function cloneUserData(userData: unknown): Record<string, unknown> {
  if (typeof userData !== "object" || userData === null) {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(userData)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function cloneGeometryPayload(
  geometry: BufferGeometry,
): ModelParseWorkerStaticGeometryPayload {
  const attributes: Record<string, ModelParseWorkerAttributePayload> = {};
  for (const [name, attribute] of Object.entries(
    geometry.attributes as Record<string, unknown>,
  )) {
    if (
      attribute instanceof Object &&
      "isBufferAttribute" in attribute &&
      attribute.isBufferAttribute === true
    ) {
      attributes[name] = cloneAttribute(attribute as BufferAttribute);
    }
  }

  return {
    attributes,
    index:
      geometry.index && geometry.index.isBufferAttribute
        ? cloneAttribute(geometry.index)
        : null,
    groups: geometry.groups.map((group) => ({
      start: group.start,
      count: group.count,
      materialIndex: group.materialIndex,
    })),
  };
}

type StaticSceneBuildContext = {
  geometries: ModelParseWorkerStaticGeometryPayload[];
  geometryIds: Map<BufferGeometry, number>;
  materials: ModelParseWorkerStaticMaterialPayload[];
  materialIds: Map<Material, number>;
  textures: ModelParseWorkerStaticTexturePayload[];
  textureIds: Map<Texture, number>;
};

function createStaticSceneBuildContext(): StaticSceneBuildContext {
  return {
    geometries: [],
    geometryIds: new Map(),
    materials: [],
    materialIds: new Map(),
    textures: [],
    textureIds: new Map(),
  };
}

function getGeometryPayload(
  geometry: BufferGeometry,
  context?: StaticSceneBuildContext,
): { payload: ModelParseWorkerStaticGeometryPayload; id?: number } {
  if (!context) {
    return { payload: cloneGeometryPayload(geometry) };
  }
  const existing = context.geometryIds.get(geometry);
  if (existing !== undefined) {
    return { payload: context.geometries[existing], id: existing };
  }
  const id = context.geometries.length;
  const payload = cloneGeometryPayload(geometry);
  context.geometryIds.set(geometry, id);
  context.geometries.push(payload);
  return { payload, id };
}

function isSupportedMaterialType(
  type: string,
): type is ModelParseWorkerStaticMaterialType {
  return (
    type === "MeshStandardMaterial" ||
    type === "MeshPhongMaterial" ||
    type === "MeshLambertMaterial" ||
    type === "MeshBasicMaterial"
  );
}

function isTexture(value: unknown): value is Texture {
  return (
    typeof value === "object" &&
    value !== null &&
    "isTexture" in value &&
    value.isTexture === true
  );
}

function isImageData(value: unknown): value is ImageData {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "width" in value &&
    "height" in value &&
    (value as ImageData).data instanceof Uint8ClampedArray
  );
}

function getTextureSamplerPayload(
  texture: Texture,
): ModelParseWorkerStaticTextureSamplerPayload {
  return {
    name: texture.name,
    userData: cloneUserData(texture.userData),
    colorSpace: texture.colorSpace,
    flipY: texture.flipY,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    magFilter: texture.magFilter,
    minFilter: texture.minFilter,
    mapping: texture.mapping,
    anisotropy: texture.anisotropy,
    offset: [texture.offset.x, texture.offset.y],
    repeat: [texture.repeat.x, texture.repeat.y],
    center: [texture.center.x, texture.center.y],
    rotation: texture.rotation,
  };
}

/**
 * Prefer baked ImageData (glTF). Otherwise preserve FBX deferred placeholders
 * that record an external relative source name. blob/data URIs are omitted —
 * embedded texture content is out of scope for the worker path.
 */
function getTexturePayload(
  texture: Texture,
): ModelParseWorkerStaticTexturePayload | null {
  const sampler = getTextureSamplerPayload(texture);
  const sourceName = texture.userData?.fbxSourceName;
  // Preserve the native neutral pixel while sidecar loading is pending.
  // userData retains fbxDeferred, so hydration still replaces this image.
  if (isImageData(texture.image)) {
    return {
      kind: "imageData",
      width: texture.image.width,
      height: texture.image.height,
      data: texture.image.data.slice(),
      ...sampler,
    };
  }

  if (typeof sourceName !== "string" || sourceName.length === 0) {
    return null;
  }
  if (/^(data:|blob:)/i.test(sourceName)) {
    return null;
  }

  return {
    kind: "deferred",
    fbxSourceName: sourceName,
    ...sampler,
  };
}

function getMaterialTexturePayloads(
  material: Material,
  options?: CanSerializeStaticNodeOptions,
  context?: StaticSceneBuildContext,
):
  | Partial<
      Record<SerializableTextureSlot, ModelParseWorkerStaticTexturePayload>
    >
  | null
  | undefined {
  const materialRecord = material as unknown as Record<string, unknown>;
  const textures: Partial<
    Record<SerializableTextureSlot, ModelParseWorkerStaticTexturePayload>
  > = {};
  let hasSerializable = false;
  const requireStrict = options?.requireSerializableTextures === true;

  for (const [key, value] of Object.entries(materialRecord)) {
    if (!isTexture(value)) {
      continue;
    }
    if (!(SERIALIZABLE_TEXTURE_SLOTS as readonly string[]).includes(key)) {
      // glTF requires every texture slot to be serializable; FBX soft mode
      // ignores unsupported slots (e.g. specularMap) so deferred map/normalMap
      // still transfer.
      if (requireStrict) {
        return null;
      }
    }
  }

  for (const slot of SERIALIZABLE_TEXTURE_SLOTS) {
    const value = materialRecord[slot];
    if (!isTexture(value)) {
      continue;
    }
    const payload = getTexturePayload(value);
    if (!payload) {
      return null;
    }
    if (requireStrict && !isImageDataStaticTexturePayload(payload)) {
      return null;
    }
    if (context) {
      const existing = context.textureIds.get(value);
      if (existing !== undefined) {
        textures[slot] = context.textures[existing];
      } else {
        const id = context.textures.length;
        context.textureIds.set(value, id);
        context.textures.push(payload);
        textures[slot] = payload;
      }
    } else {
      textures[slot] = payload;
    }
    hasSerializable = true;
  }

  return hasSerializable ? textures : undefined;
}

function canSerializeMaterial(
  material: Material | Material[] | undefined,
  options?: CanSerializeStaticNodeOptions,
) {
  if (!material) {
    return true;
  }
  const materials = Array.isArray(material) ? material : [material];
  return materials.every((entry) => {
    if (!isSupportedMaterialType(entry.type)) {
      return false;
    }
    if (options?.requireSerializableTextures) {
      return getMaterialTexturePayloads(entry, options) !== null;
    }
    return true;
  });
}

function getMaterialPayload(
  material: Material,
  options?: CanSerializeStaticNodeOptions,
  context?: StaticSceneBuildContext,
): ModelParseWorkerStaticMaterialPayload {
  if (context) {
    const existing = context.materialIds.get(material);
    if (existing !== undefined) {
      return context.materials[existing];
    }
  }
  const materialLike = material as Material & {
    color?: { getHex: () => number };
    metalness?: number;
    roughness?: number;
    vertexColors?: boolean;
    flatShading?: boolean;
  };
  const textures = getMaterialTexturePayloads(material, options, context);
  const payload: ModelParseWorkerStaticMaterialPayload = {
    type: isSupportedMaterialType(materialLike.type)
      ? materialLike.type
      : "MeshStandardMaterial",
    name: materialLike.name ?? "",
    userData: cloneUserData(material.userData),
    color: materialLike.color?.getHex() ?? 0xc7d2e3,
    metalness: materialLike.metalness ?? 0.08,
    roughness: materialLike.roughness ?? 0.72,
    opacity: materialLike.opacity,
    transparent: materialLike.transparent,
    vertexColors: materialLike.vertexColors,
    flatShading: materialLike.flatShading,
    side: materialLike.side,
    ...(textures ? { textures } : {}),
  };
  if (context) {
    const id = context.materials.length;
    context.materialIds.set(material, id);
    context.materials.push(payload);
    // The resource table owns the texture bytes. Keep the compatibility
    // `textures` aliases above while recording stable texture IDs below.
    if (payload.textures) {
      const textureIds: Partial<Record<SerializableTextureSlot, number>> = {};
      for (const [slot, texture] of Object.entries(payload.textures) as Array<
        [SerializableTextureSlot, ModelParseWorkerStaticTexturePayload]
      >) {
        const textureId = context.textures.findIndex(
          (candidate) => candidate === texture,
        );
        if (textureId >= 0) textureIds[slot] = textureId;
      }
      if (Object.keys(textureIds).length > 0) {
        payload.textureIds = textureIds;
      }
    }
  }
  return payload;
}

function getMaterialPayloads(
  material: Material | Material[] | undefined,
  options?: CanSerializeStaticNodeOptions,
  context?: StaticSceneBuildContext,
) {
  if (!material) {
    return getMaterialPayload(new MeshStandardMaterial(), options, context);
  }
  return Array.isArray(material)
    ? material.map((entry) => getMaterialPayload(entry, options, context))
    : getMaterialPayload(material, options, context);
}

function getMaterialPayloadIds(
  payload:
    | ModelParseWorkerStaticMaterialPayload
    | ModelParseWorkerStaticMaterialPayload[],
  context: StaticSceneBuildContext,
): number | number[] {
  const entries = Array.isArray(payload) ? payload : [payload];
  const ids = entries.map((entry) => {
    const id = context.materials.indexOf(entry);
    if (id < 0) {
      throw new Error("Static scene material resource was not registered.");
    }
    return id;
  });
  return Array.isArray(payload) ? ids : ids[0];
}

function collectMaterialTextureBuffers(
  material:
    | ModelParseWorkerStaticMaterialPayload
    | ModelParseWorkerStaticMaterialPayload[],
  buffers: Set<ArrayBuffer>,
) {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    if (!entry.textures) {
      continue;
    }
    for (const texture of Object.values(entry.textures)) {
      if (
        texture &&
        isImageDataStaticTexturePayload(texture) &&
        texture.data.buffer instanceof ArrayBuffer
      ) {
        buffers.add(texture.data.buffer);
      }
    }
  }
}

export function collectTransferables(
  scene: ModelParseWorkerStaticScenePayload,
): Transferable[] {
  const buffers = new Set<ArrayBuffer>();

  const collectGeometry = (geometry: ModelParseWorkerStaticGeometryPayload) => {
    for (const attribute of Object.values(geometry.attributes)) {
      if (attribute.array.buffer instanceof ArrayBuffer) {
        buffers.add(attribute.array.buffer);
      }
    }
    if (geometry.index) {
      if (geometry.index.array.buffer instanceof ArrayBuffer) {
        buffers.add(geometry.index.array.buffer);
      }
    }
  };

  const collectNode = (node: ModelParseWorkerStaticNodePayload) => {
    if (node.geometry) {
      collectGeometry(node.geometry);
    }
    if (node.material) {
      collectMaterialTextureBuffers(node.material, buffers);
    }
    for (const child of node.children) {
      collectNode(child);
    }
  };

  if (scene.resources) {
    for (const geometry of scene.resources.geometries) {
      collectGeometry(geometry);
    }
    for (const material of scene.resources.materials) {
      collectMaterialTextureBuffers(material, buffers);
    }
    for (const texture of scene.resources.textures) {
      if (
        isImageDataStaticTexturePayload(texture) &&
        texture.data.buffer instanceof ArrayBuffer
      ) {
        buffers.add(texture.data.buffer);
      }
    }
  }

  for (const mesh of scene.meshes) {
    collectGeometry(mesh);
    collectMaterialTextureBuffers(mesh.material, buffers);
  }
  if (scene.root) {
    collectNode(scene.root);
  }
  return [...buffers];
}

const EMPTY_BUDGET_USAGE: StaticScenePayloadBudgetUsage = {
  nodeCount: 0,
  geometryCount: 0,
  vertexBytes: 0,
  indexBytes: 0,
  textureDecodedBytes: 0,
};

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function checkedAdd(left: number, right: number): number | null {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
}

function checkedMultiply(left: number, right: number): number | null {
  const result = left * right;
  return Number.isSafeInteger(result) ? result : null;
}

function collectPayloadGeometries(
  scene: ModelParseWorkerStaticScenePayload,
): ModelParseWorkerStaticGeometryPayload[] {
  if (scene.resources) {
    return scene.resources.geometries;
  }
  const geometries: ModelParseWorkerStaticGeometryPayload[] = [];
  const seenAttributes = new Set<object>();
  const add = (geometry: ModelParseWorkerStaticGeometryPayload | undefined) => {
    if (!geometry) return;
    const key = geometry.attributes as object;
    if (seenAttributes.has(key)) return;
    seenAttributes.add(key);
    geometries.push(geometry);
  };
  for (const mesh of scene.meshes) {
    add({
      attributes: mesh.attributes,
      index: mesh.index,
      groups: mesh.groups,
    });
  }
  const pending = scene.root ? [scene.root] : [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    add(node.geometry);
    pending.push(...node.children);
  }
  return geometries;
}

function collectPayloadTextures(
  scene: ModelParseWorkerStaticScenePayload,
): ModelParseWorkerStaticTexturePayload[] {
  if (scene.resources) {
    return scene.resources.textures;
  }
  const textures: ModelParseWorkerStaticTexturePayload[] = [];
  const seen = new Set<object>();
  const addMaterial = (
    material:
      | ModelParseWorkerStaticMaterialPayload
      | ModelParseWorkerStaticMaterialPayload[],
  ) => {
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      for (const texture of Object.values(entry.textures ?? {})) {
        if (!texture || seen.has(texture)) continue;
        seen.add(texture);
        textures.push(texture);
      }
    }
  };
  for (const mesh of scene.meshes) addMaterial(mesh.material);
  const pending = scene.root ? [scene.root] : [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.material) addMaterial(node.material);
    pending.push(...node.children);
  }
  return textures;
}

function validateResourceIds(
  scene: ModelParseWorkerStaticScenePayload,
): StaticScenePayloadBudgetReason | null {
  const resources = scene.resources;
  if (!resources) return null;
  const validId = (id: unknown, length: number) =>
    isSafeNonNegativeInteger(id) && id < length;
  const validMaterialId = (id: unknown) => {
    if (Array.isArray(id))
      return id.every((entry) => validId(entry, resources.materials.length));
    return validId(id, resources.materials.length);
  };
  for (const mesh of scene.meshes) {
    if (
      mesh.geometryId !== undefined &&
      !validId(mesh.geometryId, resources.geometries.length)
    ) {
      return "unsafeInteger";
    }
    if (mesh.materialId !== undefined && !validMaterialId(mesh.materialId)) {
      return "unsafeInteger";
    }
  }
  const pending = scene.root ? [scene.root] : [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (
      node.geometryId !== undefined &&
      !validId(node.geometryId, resources.geometries.length)
    ) {
      return "unsafeInteger";
    }
    if (node.materialId !== undefined && !validMaterialId(node.materialId)) {
      return "unsafeInteger";
    }
    pending.push(...node.children);
  }
  for (const material of resources.materials) {
    for (const id of Object.values(material.textureIds ?? {})) {
      if (!validId(id, resources.textures.length)) return "unsafeInteger";
    }
  }
  return null;
}

/**
 * Inspect a worker payload before creating any BufferGeometry, Material, or
 * ImageData. No Three.js objects are allocated by this function.
 */
export function checkStaticScenePayloadBudget(
  scene: ModelParseWorkerStaticScenePayload,
  budget: StaticScenePayloadBudget = {},
): StaticScenePayloadBudgetCheck {
  for (const value of Object.values(budget)) {
    if (value !== undefined && !isSafeNonNegativeInteger(value)) {
      return {
        ok: false,
        reason: "invalidBudget",
        usage: { ...EMPTY_BUDGET_USAGE },
      };
    }
  }

  const usage: StaticScenePayloadBudgetUsage = { ...EMPTY_BUDGET_USAGE };
  const addUsage = (
    key: keyof StaticScenePayloadBudgetUsage,
    value: number,
  ): boolean => {
    const next = checkedAdd(usage[key], value);
    if (next === null) return false;
    usage[key] = next;
    return true;
  };
  const nodeCount = scene.root
    ? (() => {
        let count = 0;
        const pending = [scene.root!];
        while (pending.length > 0) {
          const node = pending.pop()!;
          count = checkedAdd(count, 1) ?? Number.MAX_SAFE_INTEGER;
          pending.push(...node.children);
        }
        return count;
      })()
    : scene.meshes.length + (scene.rootKind === "group" ? 1 : 0);
  if (
    !isSafeNonNegativeInteger(nodeCount) ||
    !addUsage("nodeCount", nodeCount)
  ) {
    return { ok: false, reason: "unsafeInteger", usage };
  }

  const invalidIdReason = validateResourceIds(scene);
  if (invalidIdReason) return { ok: false, reason: invalidIdReason, usage };

  const geometries = collectPayloadGeometries(scene);
  usage.geometryCount = geometries.length;
  if (!isSafeNonNegativeInteger(usage.geometryCount)) {
    return { ok: false, reason: "unsafeInteger", usage };
  }
  const seenVertexArrays = new Set<object>();
  const seenIndexArrays = new Set<object>();
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) {
      if (seenVertexArrays.has(attribute.array)) continue;
      seenVertexArrays.add(attribute.array);
      if (!addUsage("vertexBytes", attribute.array.byteLength)) {
        return { ok: false, reason: "unsafeInteger", usage };
      }
    }
    if (geometry.index && !seenIndexArrays.has(geometry.index.array)) {
      seenIndexArrays.add(geometry.index.array);
      if (!addUsage("indexBytes", geometry.index.array.byteLength)) {
        return { ok: false, reason: "unsafeInteger", usage };
      }
    }
  }

  const textureArrays = new Set<object>();
  for (const texture of collectPayloadTextures(scene)) {
    if (!isImageDataStaticTexturePayload(texture)) continue;
    if (
      !isSafeNonNegativeInteger(texture.width) ||
      !isSafeNonNegativeInteger(texture.height)
    ) {
      return { ok: false, reason: "unsafeInteger", usage };
    }
    const decodedPixels = checkedMultiply(
      checkedMultiply(texture.width, texture.height) ?? Number.MAX_SAFE_INTEGER,
      4,
    );
    if (decodedPixels === null) {
      return { ok: false, reason: "unsafeInteger", usage };
    }
    const bytes = Math.max(texture.data.byteLength, decodedPixels);
    if (!textureArrays.has(texture.data)) {
      textureArrays.add(texture.data);
      if (!addUsage("textureDecodedBytes", bytes)) {
        return { ok: false, reason: "unsafeInteger", usage };
      }
    }
  }

  const checks: Array<
    [
      keyof StaticScenePayloadBudget,
      keyof StaticScenePayloadBudgetUsage,
      StaticScenePayloadBudgetReason,
    ]
  > = [
    ["maxNodes", "nodeCount", "nodeCount"],
    ["maxGeometryCount", "geometryCount", "geometryCount"],
    ["maxVertexBytes", "vertexBytes", "vertexBytes"],
    ["maxIndexBytes", "indexBytes", "indexBytes"],
    ["maxTextureDecodedBytes", "textureDecodedBytes", "textureDecodedBytes"],
  ];
  for (const [budgetKey, usageKey, reason] of checks) {
    const limit = budget[budgetKey];
    if (limit !== undefined && usage[usageKey] > limit) {
      return { ok: false, reason, usage, limit };
    }
  }
  return { ok: true, usage };
}

export function assertStaticScenePayloadWithinBudget(
  scene: ModelParseWorkerStaticScenePayload,
  budget?: StaticScenePayloadBudget,
): StaticScenePayloadBudgetUsage {
  const result = checkStaticScenePayloadBudget(scene, budget);
  if (!result.ok) {
    throw new StaticScenePayloadBudgetError(
      result.reason,
      result.usage,
      result.limit,
    );
  }
  return result.usage;
}

function getStaticNodeType(
  object: Object3D,
): ModelParseWorkerStaticNodePayload["type"] | null {
  if (object instanceof InstancedMesh) return null;
  if (object instanceof Mesh) return "Mesh";
  if (object instanceof LineSegments) return "LineSegments";
  if (object instanceof Points) return "Points";
  if (object instanceof Group) return "Group";
  if (object.type === "Object3D") return "Object3D";
  return null;
}

export function hasAnimatedStaticSceneBlocker(object: Object3D): boolean {
  if ((object.animations?.length ?? 0) > 0) {
    return true;
  }

  let hasBlocker = false;
  object.traverse((child) => {
    if (hasBlocker) {
      return;
    }

    if (
      (child.animations?.length ?? 0) > 0 ||
      child instanceof SkinnedMesh ||
      child instanceof Bone
    ) {
      hasBlocker = true;
      return;
    }

    if (!(child instanceof Mesh)) {
      return;
    }

    if ((child.morphTargetInfluences?.length ?? 0) > 0) {
      hasBlocker = true;
      return;
    }

    hasBlocker = Object.values(child.geometry.morphAttributes).some(
      (attributes) => (attributes as ArrayLike<unknown>).length > 0,
    );
  });
  return hasBlocker;
}

export function canSerializeStaticNode(
  object: Object3D,
  options?: CanSerializeStaticNodeOptions,
): boolean {
  const type = getStaticNodeType(object);
  if (!type) {
    return false;
  }

  if (type === "Mesh" || type === "LineSegments" || type === "Points") {
    const geometryOwner = object as Mesh | LineSegments | Points;
    if (
      !(geometryOwner.geometry instanceof BufferGeometry) ||
      !canSerializeMaterial(geometryOwner.material, options)
    ) {
      return false;
    }
  }

  return object.children.every((child) =>
    canSerializeStaticNode(child, options),
  );
}

function toStaticNodePayload(
  object: Object3D,
  options?: CanSerializeStaticNodeOptions,
  context?: StaticSceneBuildContext,
): ModelParseWorkerStaticNodePayload | null {
  const type = getStaticNodeType(object);
  if (!type) {
    return null;
  }

  const node: ModelParseWorkerStaticNodePayload = {
    type,
    name: object.name,
    matrix: object.matrix.toArray(),
    children: [],
    visible: object.visible,
    userData: cloneUserData(object.userData),
  };

  if (type === "Mesh" || type === "LineSegments" || type === "Points") {
    const geometryOwner = object as Mesh | LineSegments | Points;
    if (
      !(geometryOwner.geometry instanceof BufferGeometry) ||
      !canSerializeMaterial(geometryOwner.material, options)
    ) {
      return null;
    }
    const geometry = getGeometryPayload(geometryOwner.geometry, context);
    const material = getMaterialPayloads(
      geometryOwner.material,
      options,
      context,
    );
    node.geometry = geometry.payload;
    node.geometryId = geometry.id;
    node.material = material;
    if (context) {
      node.materialId = getMaterialPayloadIds(material, context);
    }
  }

  for (const child of object.children) {
    const childNode = toStaticNodePayload(child, options, context);
    if (!childNode) {
      return null;
    }
    node.children.push(childNode);
  }

  return node;
}

export function toStaticScenePayload(
  object: Object3D,
  useTree: boolean,
  options?: CanSerializeStaticNodeOptions,
): ModelParseWorkerStaticScenePayload | null {
  if (!canSerializeStaticNode(object, options)) {
    return null;
  }

  object.updateMatrixWorld(true);
  const context = createStaticSceneBuildContext();
  const meshes: ModelParseWorkerMeshPayload[] = [];
  const root = useTree
    ? (toStaticNodePayload(object, options, context) ?? undefined)
    : undefined;
  if (useTree && !root) {
    return null;
  }

  if (!useTree) {
    object.traverse((child) => {
      if (
        !(child instanceof Mesh) ||
        !(child.geometry instanceof BufferGeometry)
      ) {
        return;
      }

      const geometry = getGeometryPayload(child.geometry, context);
      const material = getMaterialPayloads(child.material, options, context);

      meshes.push({
        name: child.name,
        matrix: child.matrixWorld.toArray(),
        userData: cloneUserData(child.userData),
        attributes: geometry.payload.attributes,
        index: geometry.payload.index,
        groups: geometry.payload.groups,
        material,
        geometryId: geometry.id,
        materialId: getMaterialPayloadIds(material, context),
      });
    });
  }

  return {
    rootKind: object instanceof Mesh ? "mesh" : "group",
    rootName: object.name,
    rootUserData: cloneUserData(object.userData),
    root,
    meshes,
    resources: {
      geometries: context.geometries,
      materials: context.materials,
      textures: context.textures,
    },
  };
}

function createBufferAttribute(payload: ModelParseWorkerAttributePayload) {
  return new BufferAttribute(
    payload.array,
    payload.itemSize,
    payload.normalized,
  );
}

type StaticSceneReconstructionContext = {
  resources?: ModelParseWorkerStaticSceneResources;
  geometries: Map<number, BufferGeometry>;
  materials: Map<number, Material>;
  textures: Map<number, Texture>;
  ownedGeometries: Set<BufferGeometry>;
  ownedMaterials: Set<Material>;
  ownedTextures: Set<Texture>;
};

function createStaticSceneReconstructionContext(
  payload: ModelParseWorkerStaticScenePayload,
): StaticSceneReconstructionContext {
  return {
    resources: payload.resources,
    geometries: new Map(),
    materials: new Map(),
    textures: new Map(),
    ownedGeometries: new Set(),
    ownedMaterials: new Set(),
    ownedTextures: new Set(),
  };
}

function createStaticGeometry(payload: ModelParseWorkerStaticGeometryPayload) {
  const geometry = new BufferGeometry();
  for (const [name, attributePayload] of Object.entries(payload.attributes)) {
    geometry.setAttribute(name, createBufferAttribute(attributePayload));
  }
  if (payload.index) {
    geometry.setIndex(createBufferAttribute(payload.index));
  }
  for (const group of payload.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function getStaticGeometry(
  payload: ModelParseWorkerStaticGeometryPayload,
  context: StaticSceneReconstructionContext,
  id?: number,
): BufferGeometry {
  if (id !== undefined) {
    const existing = context.geometries.get(id);
    if (existing) return existing;
    const resource = context.resources?.geometries[id];
    if (!resource) {
      throw new Error(`Static scene geometry resource ${id} is missing.`);
    }
    const geometry = createStaticGeometry(resource);
    context.geometries.set(id, geometry);
    context.ownedGeometries.add(geometry);
    return geometry;
  }
  const geometry = createStaticGeometry(payload);
  context.ownedGeometries.add(geometry);
  return geometry;
}

function applyTextureSamplerPayload(
  texture: Texture,
  payload: ModelParseWorkerStaticTextureSamplerPayload,
) {
  texture.name = payload.name ?? "";
  texture.userData = cloneUserData(payload.userData);
  texture.colorSpace = payload.colorSpace;
  texture.flipY = payload.flipY;
  texture.wrapS = payload.wrapS;
  texture.wrapT = payload.wrapT;
  texture.magFilter = payload.magFilter;
  texture.minFilter = payload.minFilter;
  texture.mapping = payload.mapping;
  texture.anisotropy = payload.anisotropy;
  texture.offset.fromArray(payload.offset);
  texture.repeat.fromArray(payload.repeat);
  texture.center.fromArray(payload.center);
  texture.rotation = payload.rotation;
}

function createTextureFromPayload(
  payload: ModelParseWorkerStaticTexturePayload,
  context?: StaticSceneReconstructionContext,
  id?: number,
): Texture {
  if (context && id !== undefined) {
    const existing = context.textures.get(id);
    if (existing) return existing;
    const resource = context.resources?.textures[id];
    if (!resource) {
      throw new Error(`Static scene texture resource ${id} is missing.`);
    }
    const texture = createTextureFromPayload(resource);
    context.textures.set(id, texture);
    context.ownedTextures.add(texture);
    return texture;
  }
  if (isDeferredStaticTexturePayload(payload)) {
    // Empty placeholder; main-thread FBX hydration replaces this via
    // loadDeferredTexture(fbxSourceName) without re-parsing the FBX.
    const texture = new Texture();
    applyTextureSamplerPayload(texture, payload);
    texture.userData.fbxSourceName = payload.fbxSourceName;
    texture.userData.fbxDeferred = true;
    const baseName = payload.fbxSourceName.replace(/\\/g, "/");
    texture.name ||= baseName.slice(baseName.lastIndexOf("/") + 1);
    context?.ownedTextures.add(texture);
    return texture;
  }

  const data = new Uint8ClampedArray(payload.data.length);
  data.set(payload.data);
  const image = new ImageData(data, payload.width, payload.height);
  const texture = new Texture(image);
  applyTextureSamplerPayload(texture, payload);
  texture.needsUpdate = true;
  context?.ownedTextures.add(texture);
  return texture;
}

function applyStaticMaterialTextures(
  material: Material,
  textures: ModelParseWorkerStaticMaterialPayload["textures"],
  textureIds: ModelParseWorkerStaticMaterialPayload["textureIds"],
  context?: StaticSceneReconstructionContext,
) {
  if (!textures && !textureIds) {
    return;
  }
  const materialRecord = material as unknown as Record<string, unknown>;
  for (const slot of SERIALIZABLE_TEXTURE_SLOTS) {
    const textureId = textureIds?.[slot];
    if (textureId !== undefined && context) {
      const resource = context.resources?.textures[textureId];
      if (!resource) {
        throw new Error(
          `Static scene texture resource ${textureId} is missing.`,
        );
      }
      materialRecord[slot] = createTextureFromPayload(
        resource,
        context,
        textureId,
      );
      continue;
    }
    const payload = textures?.[slot];
    if (!payload) {
      continue;
    }
    materialRecord[slot] = createTextureFromPayload(payload, context);
  }
}

function createStaticMaterial(
  payload: ModelParseWorkerStaticMaterialPayload,
  context: StaticSceneReconstructionContext,
): Material {
  const parameters = {
    color: payload.color,
    opacity: payload.opacity,
    transparent: payload.transparent,
    vertexColors: payload.vertexColors ?? false,
    side: payload.side,
  };
  const material =
    payload.type === "MeshPhongMaterial"
      ? new MeshPhongMaterial(parameters)
      : payload.type === "MeshLambertMaterial"
        ? new MeshLambertMaterial(parameters)
        : payload.type === "MeshBasicMaterial"
          ? new MeshBasicMaterial(parameters)
          : new MeshStandardMaterial({
              ...parameters,
              metalness: payload.metalness,
              roughness: payload.roughness,
            });
  material.name = payload.name;
  if ("flatShading" in material && payload.flatShading !== undefined)
    material.flatShading = payload.flatShading;
  material.userData = cloneUserData(payload.userData);
  context.ownedMaterials.add(material);
  applyStaticMaterialTextures(
    material,
    payload.textures,
    payload.textureIds,
    context,
  );
  return material;
}

function createStaticMaterials(
  payload:
    | ModelParseWorkerStaticMaterialPayload
    | ModelParseWorkerStaticMaterialPayload[],
  context: StaticSceneReconstructionContext,
  ids?: number | number[],
) {
  const entries = Array.isArray(payload) ? payload : [payload];
  const resourceIds = Array.isArray(ids) ? ids : ids === undefined ? [] : [ids];
  const materials = entries.map((entry, index) => {
    const id = resourceIds[index];
    if (id !== undefined) {
      const existing = context.materials.get(id);
      if (existing) return existing;
      const resource = context.resources?.materials[id];
      if (!resource) {
        throw new Error(`Static scene material resource ${id} is missing.`);
      }
      const material = createStaticMaterial(resource, context);
      context.materials.set(id, material);
      return material;
    }
    return createStaticMaterial(entry, context);
  });
  return Array.isArray(payload) ? materials : materials[0];
}

function applyStaticNodeTransform(
  object: Object3D,
  node: ModelParseWorkerStaticNodePayload,
) {
  object.name = node.name;
  object.userData = node.userData ?? {};
  object.visible = node.visible ?? true;
  object.matrix.fromArray(node.matrix);
  object.matrix.decompose(object.position, object.quaternion, object.scale);
}

function trackStaticNodeResources(
  object: Object3D,
  context: StaticSceneReconstructionContext,
): void {
  const resourceOwner = object as Object3D & {
    geometry?: unknown;
    material?: unknown | unknown[];
  };
  if (
    resourceOwner.geometry instanceof BufferGeometry &&
    !context.ownedGeometries.has(resourceOwner.geometry)
  ) {
    context.ownedGeometries.add(resourceOwner.geometry);
  }
  const materials = Array.isArray(resourceOwner.material)
    ? resourceOwner.material
    : resourceOwner.material
      ? [resourceOwner.material]
      : [];
  for (const material of materials) {
    if (
      typeof material === "object" &&
      material !== null &&
      "dispose" in material &&
      typeof material.dispose === "function"
    ) {
      context.ownedMaterials.add(material as Material);
    }
  }
}

function createStaticNodeObject(
  node: ModelParseWorkerStaticNodePayload,
  context: StaticSceneReconstructionContext,
) {
  const geometry = node.geometry
    ? getStaticGeometry(
        node.geometry,
        context,
        context.resources ? node.geometryId : undefined,
      )
    : null;
  const material = node.material
    ? createStaticMaterials(
        node.material,
        context,
        context.resources ? node.materialId : undefined,
      )
    : node.materialId !== undefined && context.resources
      ? createStaticMaterials(
          resolveMaterialPayloads(context, node.materialId),
          context,
          node.materialId,
        )
      : null;
  const object =
    node.type === "Mesh"
      ? new Mesh(geometry ?? new BufferGeometry(), material ?? undefined)
      : node.type === "LineSegments"
        ? new LineSegments(
            geometry ?? new BufferGeometry(),
            material ?? undefined,
          )
        : node.type === "Points"
          ? new Points(geometry ?? new BufferGeometry(), material ?? undefined)
          : node.type === "Group"
            ? new Group()
            : new Object3D();

  trackStaticNodeResources(object, context);
  applyStaticNodeTransform(object, node);
  for (const child of node.children) {
    object.add(createStaticNodeObject(child, context));
  }
  return object;
}

function resolveMaterialPayloads(
  context: StaticSceneReconstructionContext,
  ids: number | number[],
):
  | ModelParseWorkerStaticMaterialPayload
  | ModelParseWorkerStaticMaterialPayload[] {
  const resourceIds = Array.isArray(ids) ? ids : [ids];
  const payloads = resourceIds.map((id) => {
    const payload = context.resources?.materials[id];
    if (!payload) {
      throw new Error(`Static scene material resource ${id} is missing.`);
    }
    return payload;
  });
  return Array.isArray(ids) ? payloads : payloads[0];
}

function createFlatMeshFromPayload(
  meshPayload: ModelParseWorkerMeshPayload,
  context: StaticSceneReconstructionContext,
) {
  const geometry =
    meshPayload.geometryId !== undefined && context.resources
      ? getStaticGeometry(
          {
            attributes: meshPayload.attributes,
            index: meshPayload.index,
            groups: meshPayload.groups,
          },
          context,
          meshPayload.geometryId,
        )
      : getStaticGeometry(
          {
            attributes: meshPayload.attributes,
            index: meshPayload.index,
            groups: meshPayload.groups,
          },
          context,
        );
  const materialPayload =
    meshPayload.materialId !== undefined && context.resources
      ? resolveMaterialPayloads(context, meshPayload.materialId)
      : meshPayload.material;
  const material = createStaticMaterials(
    materialPayload,
    context,
    context.resources ? meshPayload.materialId : undefined,
  );

  const mesh = new Mesh(geometry, material);
  mesh.name = meshPayload.name;
  mesh.userData = meshPayload.userData;
  mesh.applyMatrix4(new Matrix4().fromArray(meshPayload.matrix));
  return mesh;
}

function createFlatStaticSceneObject(
  payload: ModelParseWorkerStaticScenePayload,
  context: StaticSceneReconstructionContext,
) {
  const root = new Group();
  root.name = payload.rootName;
  root.userData = payload.rootUserData;
  const meshes: Mesh[] = [];

  for (const meshPayload of payload.meshes) {
    meshes.push(createFlatMeshFromPayload(meshPayload, context));
  }

  if (payload.rootKind === "mesh" && meshes.length === 1) {
    return meshes[0];
  }

  root.add(...meshes);
  return root;
}

/**
 * Default mesh batch size for cooperative flat-scene reconstruction.
 * Keeps main-thread work short enough for paint while avoiding excessive yields
 * on modest scenes.
 */
export const DEFAULT_STATIC_SCENE_BATCH_SIZE = 16;

export type CreateStaticSceneObjectAsyncOptions = {
  signal?: AbortSignal;
  budget?: StaticScenePayloadBudget;
  /** Meshes constructed per cooperative turn. Defaults to {@link DEFAULT_STATIC_SCENE_BATCH_SIZE}. */
  batchSize?: number;
  /**
   * Injectable yield used between batches (tests inject a deterministic scheduler).
   * Defaults to rAF + setTimeout(0), or setTimeout(0) when rAF is unavailable.
   */
  yieldFn?: () => Promise<void>;
};

function createAbortError(message = "Static scene construction was canceled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function defaultCooperativeYield(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        setTimeout(() => resolve(), 0);
      }),
    );
    return;
  }
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
}

function finalizeFlatStaticScene(
  payload: ModelParseWorkerStaticScenePayload,
  meshes: Mesh[],
) {
  if (payload.rootKind === "mesh" && meshes.length === 1) {
    return meshes[0];
  }

  const root = new Group();
  root.name = payload.rootName;
  root.userData = payload.rootUserData;
  root.add(...meshes);
  return root;
}

function disposeStaticSceneReconstruction(
  context: StaticSceneReconstructionContext,
): void {
  for (const geometry of context.ownedGeometries) geometry.dispose();
  for (const material of context.ownedMaterials) material.dispose();
  for (const texture of context.ownedTextures) texture.dispose();
}

/**
 * Synchronous reconstruction used by callers/tests that need a blocking API.
 * Prefer {@link createStaticSceneObjectAsync} for large flat worker payloads.
 */
export function createStaticSceneObject(
  payload: ModelParseWorkerStaticScenePayload,
  options: { budget?: StaticScenePayloadBudget } = {},
) {
  if (options.budget !== undefined) {
    assertStaticScenePayloadWithinBudget(payload, options.budget);
  }
  const context = createStaticSceneReconstructionContext(payload);
  try {
    if (payload.root) {
      return createStaticNodeObject(payload.root, context);
    }
    return createFlatStaticSceneObject(payload, context);
  } catch (error) {
    disposeStaticSceneReconstruction(context);
    throw error;
  }
}

/**
 * Cooperative reconstruction for flat static-scene payloads.
 * Builds meshes in batches and yields between batches so a large FBX scene
 * does not create every geometry/material/mesh in one uninterrupted task.
 * Tree payloads (`payload.root`) still use the synchronous path.
 * Preserves mesh order, transforms, materials, root metadata, and single-mesh return.
 */
export async function createStaticSceneObjectAsync(
  payload: ModelParseWorkerStaticScenePayload,
  options: CreateStaticSceneObjectAsyncOptions = {},
): Promise<Object3D> {
  throwIfAborted(options.signal);
  if (options.budget !== undefined) {
    assertStaticScenePayloadWithinBudget(payload, options.budget);
  }
  const context = createStaticSceneReconstructionContext(payload);

  try {
    if (payload.root) {
      return createStaticNodeObject(payload.root, context);
    }

    const batchSize = Math.max(
      1,
      options.batchSize ?? DEFAULT_STATIC_SCENE_BATCH_SIZE,
    );
    const yieldFn = options.yieldFn ?? defaultCooperativeYield;
    const meshes: Mesh[] = [];
    const total = payload.meshes.length;

    for (let index = 0; index < total; index += 1) {
      if (index > 0 && index % batchSize === 0) {
        await yieldFn();
        throwIfAborted(options.signal);
      }
      meshes.push(createFlatMeshFromPayload(payload.meshes[index], context));
    }

    throwIfAborted(options.signal);
    return finalizeFlatStaticScene(payload, meshes);
  } catch (error) {
    disposeStaticSceneReconstruction(context);
    throw error;
  }
}
