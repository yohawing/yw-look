/**
 * USD parse worker.
 *
 * Goal: move the synchronous `USDLoader.parse(buffer)` call off the main
 * thread so the UI stays responsive while Three.js walks the USD scene
 * graph. Three.js `Group` instances are not structured-cloneable, so the
 * worker sends a typed static scene payload when possible and falls back
 * to `Object3D.toJSON()` for unsupported scene shapes.
 *
 * Status: ON by default since #45. Anything that would have hit the
 * lossy roundtrip cases (USDC decoding, USDZ archives, layered
 * composition) already goes through the Rust GLB pipeline, so this
 * worker only sees single-buffer USDA. `usdWorkerLoader.ts` rejects
 * worker failures into a synchronous fallback, so flipping
 * `VITE_USD_WORKER=0` is only needed for diagnosing regressions.
 *
 * See docs/usd.md §"Web Worker スケルトン".
 */

import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
import type { Object3D } from "three";
import {
  collectTransferables,
  toStaticScenePayload,
  type ModelParseWorkerStaticScenePayload,
} from "./staticScene";

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
      result:
        | { kind: "staticScene"; scene: ModelParseWorkerStaticScenePayload }
        | { kind: "objectJson"; sceneJson: unknown };
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
    const staticScene = toStaticScenePayload(object, true);
    if (staticScene) {
      const response: UsdWorkerResponse = {
        id: request.id,
        ok: true,
        result: { kind: "staticScene", scene: staticScene },
      };
      (
        self as unknown as {
          postMessage: (payload: unknown, transfer: Transferable[]) => void;
        }
      ).postMessage(response, collectTransferables(staticScene));
      return;
    }

    const response: UsdWorkerResponse = {
      id: request.id,
      ok: true,
      result: { kind: "objectJson", sceneJson: object.toJSON() },
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
