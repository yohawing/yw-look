import {
  BufferGeometry,
  Group,
  LineSegments,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  Points,
  type BufferAttribute,
  type Material,
  type Object3D,
} from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { FBXLoader } from "../vendor/FBXLoaderPatched.js";

export type ModelParseWorkerPayload =
  | {
      kind: "fbx";
      buffer: ArrayBuffer;
      resourcePath: string;
    }
  | {
      kind: "obj";
      text: string;
    }
  | {
      kind: "ply";
      buffer: ArrayBuffer;
    }
  | {
      kind: "stl";
      buffer: ArrayBuffer;
    }
  | {
      kind: "dae";
      text: string;
      basePath: string;
      textureUrls: Record<string, string>;
      missingTextureUrls: string[];
    };

export type ModelParseWorkerRequest = {
  id: number;
  path: string;
  payload: ModelParseWorkerPayload;
};

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

export type ModelParseWorkerResponse =
  | {
      id: number;
      ok: true;
      result:
        | { kind: "objectJson"; sceneJson: unknown }
        | { kind: "staticScene"; scene: ModelParseWorkerStaticScenePayload };
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

const FALLBACK_TEXTURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlWHQAAAAASUVORK5CYII=";

function isRemoteOrInlineUrl(url: string) {
  return /^(data:|blob:|https?:)/i.test(url);
}

function parseObject(payload: ModelParseWorkerPayload): Object3D {
  switch (payload.kind) {
    case "fbx":
      return new FBXLoader().parse(payload.buffer, payload.resourcePath);
    case "obj":
      return new OBJLoader().parse(payload.text);
    case "ply": {
      const geometry = new PLYLoader().parse(payload.buffer);
      geometry.computeVertexNormals();
      return new Mesh(
        geometry,
        new MeshStandardMaterial({
          color: "#c7d2e3",
          metalness: 0.08,
          roughness: 0.72,
        }),
      );
    }
    case "stl": {
      const geometry = new STLLoader().parse(payload.buffer);
      geometry.computeVertexNormals();
      return new Mesh(
        geometry,
        new MeshStandardMaterial({
          color: "#d7dde8",
          metalness: 0.1,
          roughness: 0.68,
        }),
      );
    }
    case "dae": {
      const manager = new LoadingManager();
      const missingTextureUrls = new Set(payload.missingTextureUrls);
      manager.setURLModifier((url) => {
        if (isRemoteOrInlineUrl(url)) return url;
        return (
          payload.textureUrls[url] ??
          (missingTextureUrls.has(url) ? FALLBACK_TEXTURE_DATA_URL : url)
        );
      });
      const collada = new ColladaLoader(manager).parse(
        payload.text,
        payload.basePath,
      );
      const wrapped = new Group();
      wrapped.add(collada.scene);
      return wrapped;
    }
  }
}

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

function collectTransferables(
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

function canSerializeStaticNode(object: Object3D): boolean {
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

function toStaticScenePayload(
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

function canUseStaticSceneResult(
  kind: ModelParseWorkerPayload["kind"],
  object: Object3D,
) {
  return (
    (kind === "obj" || kind === "ply" || kind === "stl") &&
    canSerializeStaticNode(object)
  );
}

self.addEventListener(
  "message",
  (event: MessageEvent<ModelParseWorkerRequest>) => {
    const request = event.data;
    try {
      const object = parseObject(request.payload);
      if (canUseStaticSceneResult(request.payload.kind, object)) {
        const scene = toStaticScenePayload(
          object,
          request.payload.kind === "obj",
        );
        if (scene) {
          const response: ModelParseWorkerResponse = {
            id: request.id,
            ok: true,
            result: { kind: "staticScene", scene },
          };
          (
            self as unknown as {
              postMessage: (payload: unknown, transfer: Transferable[]) => void;
            }
          ).postMessage(response, collectTransferables(scene));
          return;
        }
      }

      const response: ModelParseWorkerResponse = {
        id: request.id,
        ok: true,
        result: { kind: "objectJson", sceneJson: object.toJSON() },
      };
      (
        self as unknown as { postMessage: (payload: unknown) => void }
      ).postMessage(response);
    } catch (error) {
      const response: ModelParseWorkerResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      (
        self as unknown as { postMessage: (payload: unknown) => void }
      ).postMessage(response);
    }
  },
);

export {};
