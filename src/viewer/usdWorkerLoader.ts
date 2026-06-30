/**
 * Main-thread wrapper around the USD parse worker.
 *
 * Default ON since #45. The worker only handles single-buffer USDA
 * — anything that needs USDC decoding or external composition is
 * already routed to the Rust GLB pipeline via `requires_glb_preview`,
 * so the toJSON/fromJSON roundtrip the worker uses doesn't have to
 * cope with USDZ-embedded textures or layered references in practice.
 * Worker errors fall back to the synchronous main-thread parse in
 * `loaders.ts`, so flipping this off via env should only be necessary
 * if a regression is suspected.
 *
 * See docs/usd.md §"Web Worker スケルトン".
 */

import { ObjectLoader, type Object3D } from "three";
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

let workerInstance: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  {
    resolve: (object: Object3D) => void;
    reject: (error: Error) => void;
    cleanup?: () => void;
  }
>();

function rejectAllPending(error: Error): void {
  for (const [, entry] of pending) {
    entry.cleanup?.();
    entry.reject(error);
  }
  pending.clear();
  // Terminate the broken worker to release its thread and event listeners,
  // then drop the reference so the next call spawns a fresh one.
  const dying = workerInstance;
  workerInstance = null;
  dying?.terminate();
}

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

function getWorker(): Worker {
  if (workerInstance) return workerInstance;
  // Vite picks up this `new Worker(new URL(..., import.meta.url))`
  // pattern at build time and bundles the worker as a separate chunk.
  // See https://vitejs.dev/guide/features.html#web-workers
  workerInstance = new Worker(
    new URL("../workers/usdLoader.worker.ts", import.meta.url),
    { type: "module" },
  );
  workerInstance.addEventListener(
    "message",
    (event: MessageEvent<UsdWorkerResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      entry.cleanup?.();
      if (event.data.ok) {
        try {
          const loader = new ObjectLoader();
          const object = loader.parse(event.data.sceneJson as object);
          entry.resolve(object);
        } catch (error) {
          entry.reject(
            error instanceof Error
              ? error
              : new Error("Failed to deserialize USD worker payload"),
          );
        }
      } else {
        entry.reject(new Error(event.data.error));
      }
    },
  );
  // Without these listeners, a module-load failure or runtime exception
  // inside the worker leaves every pending Promise unresolved, which in
  // turn leaves the preview pipeline hanging in "loading" forever.
  // Reject everything in-flight so `loadPreviewObject` reaches its
  // catch/fallback path.
  workerInstance.addEventListener("error", (event: ErrorEvent) => {
    rejectAllPending(
      new Error(
        `USD worker error: ${event.message || "unknown worker failure"}`,
      ),
    );
  });
  workerInstance.addEventListener("messageerror", () => {
    rejectAllPending(new Error("USD worker message deserialization failed"));
  });
  return workerInstance;
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
  const id = nextRequestId++;
  const worker = getWorker();
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
  return new Promise<Object3D>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const handleAbort = () => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.cleanup?.();
      entry.reject(createAbortError());
      rejectAllPending(createAbortError());
    };
    const timeoutId = globalThis.setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.cleanup?.();
      entry.reject(createTimeoutError(path, timeoutMs));
      rejectAllPending(createTimeoutError(path, timeoutMs));
    }, timeoutMs);
    const cleanup = () => {
      globalThis.clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", handleAbort);
    };
    options.signal?.addEventListener("abort", handleAbort, { once: true });
    pending.set(id, { resolve, reject, cleanup });
    worker.postMessage(request);
  });
}
