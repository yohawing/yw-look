import {
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
  type Material,
} from "three";

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

function canSerializeMaterial(material: Material | Material[] | undefined) {
  if (!material) {
    return true;
  }
  const materials = Array.isArray(material) ? material : [material];
  return materials.every((entry) => isSupportedMaterialType(entry.type));
}

function getMaterialPayload(
  material: Material,
): ModelParseWorkerStaticMaterialPayload {
  const materialLike = material as Material & {
    color?: { getHex: () => number };
    metalness?: number;
    roughness?: number;
  };
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
  };
}

function getMaterialPayloads(material: Material | Material[] | undefined) {
  if (!material) {
    return getMaterialPayload(new MeshStandardMaterial());
  }
  return Array.isArray(material)
    ? material.map((entry) => getMaterialPayload(entry))
    : getMaterialPayload(material);
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
    for (const child of node.children) {
      collectNode(child);
    }
  };

  for (const mesh of scene.meshes) {
    collectGeometry(mesh);
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

export function canSerializeStaticNode(object: Object3D): boolean {
  const type = getStaticNodeType(object);
  if (!type) {
    return false;
  }

  if (type === "Mesh" || type === "LineSegments" || type === "Points") {
    const geometryOwner = object as Mesh | LineSegments | Points;
    if (
      !(geometryOwner.geometry instanceof BufferGeometry) ||
      !canSerializeMaterial(geometryOwner.material)
    ) {
      return false;
    }
  }

  return object.children.every((child) => canSerializeStaticNode(child));
}

function toStaticNodePayload(
  object: Object3D,
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
      !canSerializeMaterial(geometryOwner.material)
    ) {
      return null;
    }
    node.geometry = cloneGeometryPayload(geometryOwner.geometry);
    node.material = getMaterialPayloads(geometryOwner.material);
  }

  for (const child of object.children) {
    const childNode = toStaticNodePayload(child);
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
): ModelParseWorkerStaticScenePayload | null {
  object.updateMatrixWorld(true);
  const meshes: ModelParseWorkerMeshPayload[] = [];
  const root = useTree ? (toStaticNodePayload(object) ?? undefined) : undefined;
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
        material: getMaterialPayloads(child.material),
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

function createFlatStaticSceneObject(
  payload: ModelParseWorkerStaticScenePayload,
) {
  const root = new Group();
  root.name = payload.rootName;
  root.userData = payload.rootUserData;
  const meshes: Mesh[] = [];

  for (const meshPayload of payload.meshes) {
    const geometry = createStaticGeometry(meshPayload);
    const material = createStaticMaterials(meshPayload.material);

    const mesh = new Mesh(geometry, material);
    mesh.name = meshPayload.name;
    mesh.userData = meshPayload.userData;
    mesh.applyMatrix4(new Matrix4().fromArray(meshPayload.matrix));
    meshes.push(mesh);
  }

  if (payload.rootKind === "mesh" && meshes.length === 1) {
    return meshes[0];
  }

  root.add(...meshes);
  return root;
}

export function createStaticSceneObject(
  payload: ModelParseWorkerStaticScenePayload,
) {
  if (payload.root) {
    return createStaticNodeObject(payload.root);
  }
  return createFlatStaticSceneObject(payload);
}
