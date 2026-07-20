/**
 * Main-thread wrapper around the USD parse worker.
 *
 * Default ON since #45. The worker only handles single-buffer USDA
 * — anything that needs USDC decoding or external composition is
 * already routed to the Rust GLB pipeline via `requires_glb_preview`,
 * so the staticScene/JSON worker payload doesn't have to cope with
 * USDZ-embedded textures or layered references in practice.
 * Worker errors fall back to the synchronous main-thread parse in
 * `loaders.ts`, so flipping this off via env should only be necessary
 * if a regression is suspected.
 */

import { ObjectLoader, type Object3D } from "three";
import { createStaticSceneObject } from "../workers/staticScene";
import type {
  UsdWorkerRequest,
  UsdWorkerResponse,
} from "../workers/usdLoader.worker";

/**
 * `true` unless `VITE_USD_WORKER=0` is set at build time. The default
 * was flipped from OFF → ON in #45; the env override is kept as a
 * one-line escape hatch for diagnosing worker-only regressions
 * without rebuilding from a different commit.
 */
export function isUsdWorkerEnabled(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> })
      .env;
    return env?.VITE_USD_WORKER !== "0";
  } catch {
    return true;
  }
}

let nextRequestId = 1;

function createAbortError(message = "USD parse was canceled."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createTimeoutError(path: string, timeoutMs: number): Error {
  const error = new Error(
    `USD parse timed out after ${Math.round(timeoutMs / 1000)}s: ${path}`,
  );
  error.name = "TimeoutError";
  return error;
}

/**
 * Parse a USD asset inside the worker and return a reconstructed
 * `Object3D`. Throws if the worker is disabled or if the parse fails —
 * callers are expected to catch and fall back to the synchronous path.
 */
export async function parseUsdInWorker(
  path: string,
  payload: UsdWorkerRequest["payload"],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Object3D> {
  if (!isUsdWorkerEnabled()) {
    throw new Error("USD worker is not enabled");
  }
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const worker = new Worker(
    new URL("../workers/usdLoader.worker.ts", import.meta.url),
    { type: "module" },
  );
  const id = nextRequestId++;
  const timeoutMs = options.timeoutMs ?? 30_000;

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
    const handleMessage = (event: MessageEvent<UsdWorkerResponse>) => {
      if (event.data.id !== id) return;
      if (!event.data.ok) {
        settleReject(new Error(event.data.error));
        return;
      }
      try {
        const object =
          event.data.result.kind === "staticScene"
            ? createStaticSceneObject(event.data.result.scene)
            : new ObjectLoader().parse(event.data.result.sceneJson as object);
        settleResolve(object);
      } catch (error) {
        settleReject(
          error instanceof Error
            ? error
            : new Error("Failed to deserialize USD worker payload"),
        );
      }
    };
    const handleError = (event: ErrorEvent) => {
      settleReject(
        new Error(
          `USD worker error: ${event.message || "unknown worker failure"}`,
        ),
      );
    };
    const handleMessageError = () => {
      settleReject(new Error("USD worker message deserialization failed"));
    };
    const timeoutId = globalThis.setTimeout(() => {
      settleReject(createTimeoutError(path, timeoutMs));
    }, timeoutMs);

    options.signal?.addEventListener("abort", handleAbort, { once: true });
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.addEventListener("messageerror", handleMessageError);

    // Clone the binary buffer instead of transferring it. Transferring
    // detaches the caller's ArrayBuffer, which would break the documented
    // "worker failed → fall back to main-thread parse" path in
    // `loaders.ts` because the fallback still needs the original buffer.
    // Phase 3 can revisit the transfer path once the worker route is
    // promoted from experimental.
    const safePayload: UsdWorkerRequest["payload"] =
      payload.kind === "binary"
        ? { kind: "binary", buffer: payload.buffer.slice(0) }
        : payload;
    const request: UsdWorkerRequest = { id, path, payload: safePayload };
    try {
      worker.postMessage(request);
    } catch (error) {
      settleReject(
        error instanceof Error
          ? error
          : new Error("Failed to post USD parse request to worker"),
      );
    }
  });
}
