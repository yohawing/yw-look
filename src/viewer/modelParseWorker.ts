/**
 * Main-thread wrapper around the model parse worker.
 *
 * Lifecycle policy: one Worker per parse request. A shared pool is deferred
 * because per-request workers keep abort/error/timeout cleanup isolated and
 * prevent cross-request buffer lifetime bugs when a peer aborts mid-flight.
 *
 * Buffer ownership: binary payloads are cloned via `buffer.slice(0)` before
 * postMessage. Transfer would detach the caller's ArrayBuffer and break the
 * documented fallback path where loaders retry on the main thread with the
 * original buffer after a worker failure. Abort/timeout rejections suppress
 * that fallback via `isAbortOrTimeoutError`.
 */

import { ObjectLoader, type Object3D } from "three";
import { createStaticSceneObject } from "../workers/staticScene";
import type {
  ModelParseWorkerPayload,
  ModelParseWorkerRequest,
  ModelParseWorkerResponse,
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

  // Per-request worker: terminate on settle so aborted peers cannot leak.
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

    // Clone binary buffers so callers retain ownership for main-thread fallback.
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
