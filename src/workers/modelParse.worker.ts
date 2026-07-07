import {
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Object3D,
} from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { FBXLoader } from "../vendor/FBXLoaderPatched.js";
import { errorMessage } from "../lib/errors";
import { bakeImageBitmapTextures } from "./textureBake";
import {
  canSerializeStaticNode,
  collectTransferables,
  hasAnimatedStaticSceneBlocker,
  toStaticScenePayload,
  type ModelParseWorkerStaticScenePayload,
} from "./staticScene";
export type {
  ModelParseWorkerAttributeArray,
  ModelParseWorkerAttributePayload,
  ModelParseWorkerMeshPayload,
  ModelParseWorkerStaticGeometryPayload,
  ModelParseWorkerStaticMaterialPayload,
  ModelParseWorkerStaticMaterialType,
  ModelParseWorkerStaticNodePayload,
  ModelParseWorkerStaticScenePayload,
} from "./staticScene";

export type ModelParseWorkerPayload =
  | {
      kind: "fbx";
      buffer: ArrayBuffer;
      resourcePath: string;
    }
  | {
      kind: "glb";
      buffer: ArrayBuffer;
    }
  | {
      kind: "gltf";
      text: string;
      resourceUrls: Record<string, string>;
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

export function ensureVertexNormals(geometry: BufferGeometry): void {
  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
}

function isRemoteOrInlineUrl(url: string) {
  return /^(data:|blob:|https?:)/i.test(url);
}

async function parseGltfPayload(
  payload: Extract<ModelParseWorkerPayload, { kind: "glb" | "gltf" }>,
): Promise<Object3D> {
  const manager = new LoadingManager();
  if (payload.kind === "gltf") {
    manager.setURLModifier((url) => {
      if (isRemoteOrInlineUrl(url)) return url;
      return payload.resourceUrls[url] ?? url;
    });
  }
  const loader = new GLTFLoader(manager);
  const gltf =
    payload.kind === "glb"
      ? await loader.parseAsync(payload.buffer, "")
      : await loader.parseAsync(payload.text, "");
  gltf.scene.animations = gltf.animations;
  await bakeImageBitmapTextures(gltf.scene);
  return gltf.scene;
}

async function parseObject(
  payload: ModelParseWorkerPayload,
): Promise<Object3D> {
  switch (payload.kind) {
    case "fbx":
      return new FBXLoader().parse(payload.buffer, payload.resourcePath);
    case "glb":
    case "gltf":
      return parseGltfPayload(payload);
    case "obj":
      return new OBJLoader().parse(payload.text);
    case "ply": {
      const geometry = new PLYLoader().parse(payload.buffer);
      ensureVertexNormals(geometry);
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
      ensureVertexNormals(geometry);
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

const STATIC_SCENE_KINDS = new Set<ModelParseWorkerPayload["kind"]>([
  "obj",
  "ply",
  "stl",
  "dae",
  "fbx",
  "glb",
  "gltf",
]);

const ANIMATED_STATIC_SCENE_BLOCKER_KINDS = new Set<
  ModelParseWorkerPayload["kind"]
>(["fbx", "glb", "gltf"]);

export function canUseStaticSceneResult(
  kind: ModelParseWorkerPayload["kind"],
  object: Object3D,
) {
  if (
    ANIMATED_STATIC_SCENE_BLOCKER_KINDS.has(kind) &&
    hasAnimatedStaticSceneBlocker(object)
  ) {
    return false;
  }

  if (!STATIC_SCENE_KINDS.has(kind)) {
    return false;
  }

  const requireSerializableTextures = kind === "glb" || kind === "gltf";
  return canSerializeStaticNode(object, { requireSerializableTextures });
}

self.addEventListener(
  "message",
  (event: MessageEvent<ModelParseWorkerRequest>) => {
    const request = event.data;
    void (async () => {
      try {
        const object = await parseObject(request.payload);
        if (canUseStaticSceneResult(request.payload.kind, object)) {
          const requireSerializableTextures =
            request.payload.kind === "glb" || request.payload.kind === "gltf";
          const scene = toStaticScenePayload(
            object,
            request.payload.kind === "obj" || request.payload.kind === "dae",
            { requireSerializableTextures },
          );
          if (scene) {
            const response: ModelParseWorkerResponse = {
              id: request.id,
              ok: true,
              result: { kind: "staticScene", scene },
            };
            (
              self as unknown as {
                postMessage: (
                  payload: unknown,
                  transfer: Transferable[],
                ) => void;
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
          error: errorMessage(error, "Failed to parse model in worker."),
        };
        (
          self as unknown as { postMessage: (payload: unknown) => void }
        ).postMessage(response);
      }
    })();
  },
);

export {};
