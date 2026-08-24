import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
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
  color: number;
  metalness: number;
  roughness: number;
  opacity: number;
  transparent: boolean;
  side: Material["side"];
  textures?: Partial<
    Record<SerializableTextureSlot, ModelParseWorkerStaticTexturePayload>
  >;
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
};

export type ModelParseWorkerStaticNodePayload = {
  type: "Group" | "Mesh" | "LineSegments" | "Points" | "Object3D";
  name: string;
  matrix: number[];
  children: ModelParseWorkerStaticNodePayload[];
  geometry?: ModelParseWorkerStaticGeometryPayload;
  material?:
    | ModelParseWorkerStaticMaterialPayload
    | ModelParseWorkerStaticMaterialPayload[];
  visible?: boolean;
  userData?: Record<string, unknown>;
};

export type ModelParseWorkerStaticScenePayload = {
  rootKind: "group" | "mesh";
  rootName: string;
  rootUserData: Record<string, unknown>;
  root?: ModelParseWorkerStaticNodePayload;
  meshes: ModelParseWorkerMeshPayload[];
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
  if (
    texture.userData?.fbxDeferred === true &&
    typeof sourceName === "string" &&
    sourceName.length > 0 &&
    !/^(data:|blob:)/i.test(sourceName)
  ) {
    return {
      kind: "deferred",
      fbxSourceName: sourceName,
      ...sampler,
    };
  }
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
    textures[slot] = payload;
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
): ModelParseWorkerStaticMaterialPayload {
  const materialLike = material as Material & {
    color?: { getHex: () => number };
    metalness?: number;
    roughness?: number;
  };
  const textures = getMaterialTexturePayloads(material, options);
  return {
    type: isSupportedMaterialType(materialLike.type)
      ? materialLike.type
      : "MeshStandardMaterial",
    name: materialLike.name ?? "",
    color: materialLike.color?.getHex() ?? 0xc7d2e3,
    metalness: materialLike.metalness ?? 0.08,
    roughness: materialLike.roughness ?? 0.72,
    opacity: materialLike.opacity,
    transparent: materialLike.transparent,
    side: materialLike.side,
    ...(textures ? { textures } : {}),
  };
}

function getMaterialPayloads(
  material: Material | Material[] | undefined,
  options?: CanSerializeStaticNodeOptions,
) {
  if (!material) {
    return getMaterialPayload(new MeshStandardMaterial(), options);
  }
  return Array.isArray(material)
    ? material.map((entry) => getMaterialPayload(entry, options))
    : getMaterialPayload(material, options);
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

  for (const mesh of scene.meshes) {
    collectGeometry(mesh);
    collectMaterialTextureBuffers(mesh.material, buffers);
  }
  if (scene.root) {
    collectNode(scene.root);
  }
  return [...buffers];
}

function getStaticNodeType(
  object: Object3D,
): ModelParseWorkerStaticNodePayload["type"] | null {
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
    node.geometry = cloneGeometryPayload(geometryOwner.geometry);
    node.material = getMaterialPayloads(geometryOwner.material, options);
  }

  for (const child of object.children) {
    const childNode = toStaticNodePayload(child, options);
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
  const meshes: ModelParseWorkerMeshPayload[] = [];
  const root = useTree
    ? (toStaticNodePayload(object, options) ?? undefined)
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

      const geometry = cloneGeometryPayload(child.geometry);

      meshes.push({
        name: child.name,
        matrix: child.matrixWorld.toArray(),
        userData: cloneUserData(child.userData),
        attributes: geometry.attributes,
        index: geometry.index,
        groups: geometry.groups,
        material: getMaterialPayloads(child.material, options),
      });
    });
  }

  return {
    rootKind: object instanceof Mesh ? "mesh" : "group",
    rootName: object.name,
    rootUserData: cloneUserData(object.userData),
    root,
    meshes,
  };
}

function createBufferAttribute(payload: ModelParseWorkerAttributePayload) {
  return new BufferAttribute(
    payload.array,
    payload.itemSize,
    payload.normalized,
  );
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

function applyTextureSamplerPayload(
  texture: Texture,
  payload: ModelParseWorkerStaticTextureSamplerPayload,
) {
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
): Texture {
  if (isDeferredStaticTexturePayload(payload)) {
    // Empty placeholder; main-thread FBX hydration replaces this via
    // loadDeferredTexture(fbxSourceName) without re-parsing the FBX.
    const texture = new Texture();
    texture.userData.fbxSourceName = payload.fbxSourceName;
    texture.userData.fbxDeferred = true;
    const baseName = payload.fbxSourceName.replace(/\\/g, "/");
    texture.name = baseName.slice(baseName.lastIndexOf("/") + 1);
    applyTextureSamplerPayload(texture, payload);
    return texture;
  }

  const data = new Uint8ClampedArray(payload.data.length);
  data.set(payload.data);
  const image = new ImageData(data, payload.width, payload.height);
  const texture = new Texture(image);
  applyTextureSamplerPayload(texture, payload);
  texture.needsUpdate = true;
  return texture;
}

function applyStaticMaterialTextures(
  material: Material,
  textures: ModelParseWorkerStaticMaterialPayload["textures"],
) {
  if (!textures) {
    return;
  }
  const materialRecord = material as unknown as Record<string, unknown>;
  for (const slot of SERIALIZABLE_TEXTURE_SLOTS) {
    const payload = textures[slot];
    if (!payload) {
      continue;
    }
    materialRecord[slot] = createTextureFromPayload(payload);
  }
}

function createStaticMaterial(
  payload: ModelParseWorkerStaticMaterialPayload,
): Material {
  const parameters = {
    color: payload.color,
    opacity: payload.opacity,
    transparent: payload.transparent,
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
  applyStaticMaterialTextures(material, payload.textures);
  return material;
}

function createStaticMaterials(
  payload:
    | ModelParseWorkerStaticMaterialPayload
    | ModelParseWorkerStaticMaterialPayload[],
) {
  return Array.isArray(payload)
    ? payload.map((entry) => createStaticMaterial(entry))
    : createStaticMaterial(payload);
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

function createStaticNodeObject(node: ModelParseWorkerStaticNodePayload) {
  const geometry = node.geometry ? createStaticGeometry(node.geometry) : null;
  const material = node.material ? createStaticMaterials(node.material) : null;
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

  applyStaticNodeTransform(object, node);
  for (const child of node.children) {
    object.add(createStaticNodeObject(child));
  }
  return object;
}

function createFlatMeshFromPayload(meshPayload: ModelParseWorkerMeshPayload) {
  const geometry = createStaticGeometry(meshPayload);
  const material = createStaticMaterials(meshPayload.material);

  const mesh = new Mesh(geometry, material);
  mesh.name = meshPayload.name;
  mesh.userData = meshPayload.userData;
  mesh.applyMatrix4(new Matrix4().fromArray(meshPayload.matrix));
  return mesh;
}

function createFlatStaticSceneObject(
  payload: ModelParseWorkerStaticScenePayload,
) {
  const root = new Group();
  root.name = payload.rootName;
  root.userData = payload.rootUserData;
  const meshes: Mesh[] = [];

  for (const meshPayload of payload.meshes) {
    meshes.push(createFlatMeshFromPayload(meshPayload));
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

/**
 * Synchronous reconstruction used by callers/tests that need a blocking API.
 * Prefer {@link createStaticSceneObjectAsync} for large flat worker payloads.
 */
export function createStaticSceneObject(
  payload: ModelParseWorkerStaticScenePayload,
) {
  if (payload.root) {
    return createStaticNodeObject(payload.root);
  }
  return createFlatStaticSceneObject(payload);
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

  if (payload.root) {
    return createStaticNodeObject(payload.root);
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
    meshes.push(createFlatMeshFromPayload(payload.meshes[index]));
  }

  throwIfAborted(options.signal);
  return finalizeFlatStaticScene(payload, meshes);
}
