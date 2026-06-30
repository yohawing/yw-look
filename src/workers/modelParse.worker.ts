import {
  BufferGeometry,
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
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

export type ModelParseWorkerMeshPayload = {
  name: string;
  matrix: number[];
  userData: Record<string, unknown>;
  attributes: Record<string, ModelParseWorkerAttributePayload>;
  index: ModelParseWorkerAttributePayload | null;
  groups: Array<{ start: number; count: number; materialIndex?: number }>;
  material: {
    name: string;
    color: number;
    metalness: number;
    roughness: number;
  };
};

export type ModelParseWorkerStaticScenePayload = {
  rootKind: "group" | "mesh";
  rootName: string;
  rootUserData: Record<string, unknown>;
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

function getMaterialPayload(material: Material | Material[] | undefined) {
  const source = Array.isArray(material) ? material[0] : material;
  const materialLike = source as
    | (Material & {
        color?: { getHex: () => number };
        metalness?: number;
        roughness?: number;
      })
    | undefined;
  return {
    name: materialLike?.name ?? "",
    color: materialLike?.color?.getHex() ?? 0xc7d2e3,
    metalness: materialLike?.metalness ?? 0.08,
    roughness: materialLike?.roughness ?? 0.72,
  };
}

function collectTransferables(
  scene: ModelParseWorkerStaticScenePayload,
): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const mesh of scene.meshes) {
    for (const attribute of Object.values(mesh.attributes)) {
      if (attribute.array.buffer instanceof ArrayBuffer) {
        buffers.add(attribute.array.buffer);
      }
    }
    if (mesh.index) {
      if (mesh.index.array.buffer instanceof ArrayBuffer) {
        buffers.add(mesh.index.array.buffer);
      }
    }
  }
  return [...buffers];
}

function toStaticScenePayload(
  object: Object3D,
): ModelParseWorkerStaticScenePayload {
  object.updateMatrixWorld(true);
  const meshes: ModelParseWorkerMeshPayload[] = [];

  object.traverse((child) => {
    if (
      !(child instanceof Mesh) ||
      !(child.geometry instanceof BufferGeometry)
    ) {
      return;
    }

    const attributes: Record<string, ModelParseWorkerAttributePayload> = {};
    for (const [name, attribute] of Object.entries(
      child.geometry.attributes as Record<string, unknown>,
    )) {
      if (
        attribute instanceof Object &&
        "isBufferAttribute" in attribute &&
        attribute.isBufferAttribute === true
      ) {
        attributes[name] = cloneAttribute(attribute as BufferAttribute);
      }
    }

    meshes.push({
      name: child.name,
      matrix: child.matrixWorld.toArray(),
      userData: cloneUserData(child.userData),
      attributes,
      index:
        child.geometry.index && child.geometry.index.isBufferAttribute
          ? cloneAttribute(child.geometry.index)
          : null,
      groups: child.geometry.groups.map((group) => ({
        start: group.start,
        count: group.count,
        materialIndex: group.materialIndex,
      })),
      material: getMaterialPayload(child.material),
    });
  });

  return {
    rootKind: object instanceof Mesh ? "mesh" : "group",
    rootName: object.name,
    rootUserData: cloneUserData(object.userData),
    meshes,
  };
}

function canUseStaticSceneResult(
  kind: ModelParseWorkerPayload["kind"],
  object: Object3D,
) {
  return (
    (kind === "ply" || kind === "stl") &&
    object instanceof Mesh &&
    object.geometry instanceof BufferGeometry
  );
}

self.addEventListener(
  "message",
  (event: MessageEvent<ModelParseWorkerRequest>) => {
    const request = event.data;
    try {
      const object = parseObject(request.payload);
      if (canUseStaticSceneResult(request.payload.kind, object)) {
        const scene = toStaticScenePayload(object);
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
