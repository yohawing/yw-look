/**
 * Main-thread wrapper around the experimental USD parse worker.
 *
 * Phase 2 deliverable: the scaffold and call site, behind a hard off
 * switch. `isUsdWorkerEnabled()` is the single gate — everywhere else
 * we pretend the worker doesn't exist until Phase 3 validates the
 * toJSON/fromJSON roundtrip against real assets.
 *
 * See docs/usd.md.
 */

import { ObjectLoader, type Object3D } from "three";
import type {
  UsdWorkerRequest,
  UsdWorkerResponse,
} from "../workers/usdLoader.worker";

/**
 * Phase 2 default: OFF. Flip `VITE_USD_WORKER=1` at build time to
 * opt-in locally. We intentionally do not expose this in Settings yet
 * — fall-through still goes to the synchronous path in `loaders.ts`.
 */
export function isUsdWorkerEnabled(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> })
      .env;
    return env?.VITE_USD_WORKER === "1";
  } catch {
    return false;
  }
}

let workerInstance: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (object: Object3D) => void; reject: (error: Error) => void }
>();

function rejectAllPending(error: Error): void {
  for (const [, entry] of pending) {
    entry.reject(error);
  }
  pending.clear();
  // Terminate the broken worker to release its thread and event listeners,
  // then drop the reference so the next call spawns a fresh one.
  const dying = workerInstance;
  workerInstance = null;
  dying?.terminate();
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
): Promise<Object3D> {
  if (!isUsdWorkerEnabled()) {
    throw new Error("USD worker is not enabled");
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
    pending.set(id, { resolve, reject });
    worker.postMessage(request);
  });
}
