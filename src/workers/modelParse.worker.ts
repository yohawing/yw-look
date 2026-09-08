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
  | { kind: "3mf"; buffer: ArrayBuffer }
  | {
      kind: "glb";
      buffer: ArrayBuffer;
    }
  | {
      kind: "fbxGlb";
      buffer: ArrayBuffer;
    }
  | {
      kind: "gltf";
      text: string;
      resourceUrls: Record<string, string>;
      preferObjectJson?: boolean;
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
  payload: Extract<
    ModelParseWorkerPayload,
    { kind: "glb" | "fbxGlb" | "gltf" }
  >,
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
    payload.kind === "glb" || payload.kind === "fbxGlb"
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
    case "3mf": {
      const { parseThreeMf } = await import("./threeMfParse");
      return parseThreeMf(payload.buffer);
    }
    case "glb":
    case "fbxGlb":
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
      if (!collada) {
        throw new Error("Unable to parse Collada scene.");
      }
      const wrapped = new Group();
      wrapped.add(collada.scene);
      return wrapped;
    }
  }
}

const STATIC_SCENE_KINDS = new Set<ModelParseWorkerPayload["kind"]>([
  "3mf",
  "obj",
  "ply",
  "stl",
  "dae",
  "fbxGlb",
  "glb",
  "gltf",
]);

const ANIMATED_STATIC_SCENE_BLOCKER_KINDS = new Set<
  ModelParseWorkerPayload["kind"]
>(["fbxGlb", "glb", "gltf"]);

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

  const requireSerializableTextures =
    kind === "glb" || kind === "gltf" || kind === "3mf";
  return canSerializeStaticNode(object, { requireSerializableTextures });
}

self.addEventListener(
  "message",
  (event: MessageEvent<ModelParseWorkerRequest>) => {
    const request = event.data;
    void (async () => {
      try {
        const object = await parseObject(request.payload);
        if (
          !(
            request.payload.kind === "gltf" &&
            request.payload.preferObjectJson === true
          ) &&
          canUseStaticSceneResult(request.payload.kind, object)
        ) {
          const requireSerializableTextures =
            request.payload.kind === "glb" ||
            request.payload.kind === "gltf" ||
            request.payload.kind === "3mf";
          const scene = toStaticScenePayload(
            object,
            request.payload.kind === "obj" ||
              request.payload.kind === "dae" ||
              request.payload.kind === "3mf",
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

        if (request.payload.kind === "3mf")
          throw new Error(
            "3MF: scene cannot be transferred safely from worker",
          );

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
