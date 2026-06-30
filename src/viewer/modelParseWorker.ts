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
  ObjectLoader,
  Object3D,
  Points,
  type Material,
} from "three";
import type {
  ModelParseWorkerAttributePayload,
  ModelParseWorkerPayload,
  ModelParseWorkerRequest,
  ModelParseWorkerResponse,
  ModelParseWorkerStaticGeometryPayload,
  ModelParseWorkerStaticMaterialPayload,
  ModelParseWorkerStaticNodePayload,
  ModelParseWorkerStaticScenePayload,
} from "../workers/modelParse.worker";

export const DEFAULT_MODEL_PARSE_TIMEOUT_MS = 30_000;

export function isModelParseWorkerEnabled(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> })
      .env;
    return env?.VITE_MODEL_PARSE_WORKER !== "0";
  } catch {
    return true;
  }
}

function createAbortError(message = "Model parse was canceled."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createTimeoutError(path: string, timeoutMs: number): Error {
  const error = new Error(
    `Model parse timed out after ${Math.round(timeoutMs / 1000)}s: ${path}`,
  );
  error.name = "TimeoutError";
  return error;
}

export function isAbortOrTimeoutError(error: unknown): boolean {
  // Timeout is terminal by design: falling back to a synchronous parse after
  // a worker timeout would reintroduce the UI freeze this loader path avoids.
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

let nextRequestId = 1;

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

function createStaticSceneObject(payload: ModelParseWorkerStaticScenePayload) {
  if (payload.root) {
    return createStaticNodeObject(payload.root);
  }
  return createFlatStaticSceneObject(payload);
}

export async function parseModelInWorker(
  path: string,
  payload: ModelParseWorkerPayload,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<Object3D> {
  if (!isModelParseWorkerEnabled()) {
    throw new Error("Model parse worker is not enabled");
  }
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const worker = new Worker(
    new URL("../workers/modelParse.worker.ts", import.meta.url),
    { type: "module" },
  );
  const id = nextRequestId++;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MODEL_PARSE_TIMEOUT_MS;

  return new Promise<Object3D>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      globalThis.clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", handleAbort);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("messageerror", handleMessageError);
      worker.terminate();
    };
    const settleResolve = (object: Object3D) => {
      if (settled) return;
      cleanup();
      resolve(object);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      settleReject(createAbortError());
    };
    const handleMessage = (event: MessageEvent<ModelParseWorkerResponse>) => {
      if (event.data.id !== id) return;
      if (!event.data.ok) {
        settleReject(new Error(event.data.error));
        return;
      }
      try {
        if (event.data.result.kind === "staticScene") {
          settleResolve(createStaticSceneObject(event.data.result.scene));
          return;
        }
        const loader = new ObjectLoader();
        settleResolve(loader.parse(event.data.result.sceneJson as object));
      } catch (error) {
        settleReject(
          error instanceof Error
            ? error
            : new Error("Failed to deserialize model worker payload"),
        );
      }
    };
    const handleError = (event: ErrorEvent) => {
      settleReject(
        new Error(
          `Model parse worker error: ${event.message || "unknown worker failure"}`,
        ),
      );
    };
    const handleMessageError = () => {
      settleReject(
        new Error("Model parse worker message deserialization failed"),
      );
    };
    const timeoutId = globalThis.setTimeout(() => {
      settleReject(createTimeoutError(path, timeoutMs));
    }, timeoutMs);

    options.signal?.addEventListener("abort", handleAbort, { once: true });
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.addEventListener("messageerror", handleMessageError);

    const safePayload: ModelParseWorkerPayload =
      "buffer" in payload
        ? { ...payload, buffer: payload.buffer.slice(0) }
        : payload;
    const request: ModelParseWorkerRequest = { id, path, payload: safePayload };
    try {
      worker.postMessage(request);
    } catch (error) {
      settleReject(
        error instanceof Error
          ? error
          : new Error("Failed to post model parse request to worker"),
      );
    }
  });
}
