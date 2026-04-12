/**
 * Experimental USD parse worker (Phase 2 scaffold).
 *
 * Goal: move the synchronous `USDLoader.parse(buffer)` call off the main
 * thread so the UI stays responsive while Three.js walks the USD scene
 * graph. Three.js `Group` instances are not structured-cloneable, so we
 * serialize via `Object3D.toJSON()` in the worker and rebuild on the
 * main thread with `ObjectLoader.parse()`.
 *
 * Status: OFF by default. `src/viewer/usdWorkerLoader.ts` only routes
 * traffic here when `import.meta.env.VITE_USD_WORKER === "1"`. The
 * toJSON/fromJSON roundtrip has known lossy cases (custom materials,
 * USDZ-embedded textures) that will be validated in Phase 3 before we
 * enable it for real users.
 *
 * See docs/usd.md §"Web Worker スケルトン" for the rationale and
 * the Phase 3 acceptance criteria.
 */

import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
import type { Object3D } from "three";

export type UsdWorkerRequest = {
  id: number;
  /** Original file path, carried through for diagnostics only. */
  path: string;
  /** Either raw USDA text (for `.usda`) or a full binary buffer. */
  payload:
    | { kind: "text"; text: string }
    | { kind: "binary"; buffer: ArrayBuffer };
};

export type UsdWorkerResponse =
  | {
      id: number;
      ok: true;
      /** Serialized via `Object3D.toJSON()`. */
      sceneJson: unknown;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

self.addEventListener("message", (event: MessageEvent<UsdWorkerRequest>) => {
  const request = event.data;
  try {
    const loader = new USDLoader();
    let object: Object3D;
    if (request.payload.kind === "text") {
      object = loader.parse(request.payload.text);
    } else {
      object = loader.parse(request.payload.buffer);
    }
    const sceneJson = object.toJSON();
    const response: UsdWorkerResponse = {
      id: request.id,
      ok: true,
      sceneJson,
    };
    (
      self as unknown as { postMessage: (payload: unknown) => void }
    ).postMessage(response);
  } catch (error) {
    const response: UsdWorkerResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (
      self as unknown as { postMessage: (payload: unknown) => void }
    ).postMessage(response);
  }
});

// Ensure the file is treated as a module by TS even when the worker
// has no imports at compile time in some tsconfigs.
export {};
