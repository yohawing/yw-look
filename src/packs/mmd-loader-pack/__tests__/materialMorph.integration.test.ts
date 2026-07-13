import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FallbackCore,
  ThreeMmdLoader,
  disposeMmdModel,
  syncMmdMaterialStates,
  syncMmdOutlineMaterialStates,
} from "@yohawing/three-mmd-loader";
import type { MmdRuntimeModelHandle } from "../../../types/viewer";
import {
  attachMmdMaterialMorphRuntime,
  createMmdMaterialMorphData,
  type MmdMaterialMorph,
  type MmdMaterialState,
} from "../materialMorph";

describe("generated PMX material morph allocation", () => {
  it("measures changing weights on a loader-created model", async () => {
    const bytes = new Uint8Array(
      await readFile(
        path.resolve(
          process.cwd(),
          "tests/fixtures/models/material-morph-two-materials.pmx",
        ),
      ),
    );
    const core = new FallbackCore();
    const loader = new ThreeMmdLoader({ core });
    const mmd = await loader.loadModel(bytes, {
      outline: true,
      materialRenderOrder: true,
      morphSplit: true,
      frustumCulled: false,
    });
    const parsed = core.loadModel(bytes);
    try {
      attachMmdMaterialMorphRuntime(
        mmd as unknown as MmdRuntimeModelHandle,
        createMmdMaterialMorphData(
          parsed.materials() as Array<
            Omit<
              MmdMaterialState,
              "textureFactor" | "sphereTextureFactor" | "toonTextureFactor"
            >
          >,
          parsed.morphs() as MmdMaterialMorph[],
        ),
        syncMmdMaterialStates,
        syncMmdOutlineMaterialStates,
      );

      const weights = mmd.mesh.morphTargetInfluences;
      expect(weights).toBeDefined();
      expect(weights).toHaveLength(2);
      const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
      gc?.();
      const heapBefore = process.memoryUsage().heapUsed;
      const startedAt = performance.now();
      const iterations = 50_000;
      for (let frame = 1; frame <= iterations; frame += 1) {
        weights![0] = frame % 2;
        weights![1] = (frame + 1) % 2;
        mmd.syncMaterialMorphs?.();
      }
      const elapsedMs = performance.now() - startedAt;
      gc?.();
      const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

      console.info(
        `material-morph-real-model-hot-path ${JSON.stringify({ iterations, elapsedMs: Math.round(elapsedMs), heapDeltaBytes, forcedGc: Boolean(gc), core: mmd.diagnostics.core.kind })}`,
      );
      expect(Number.isFinite(heapDeltaBytes)).toBe(true);
    } finally {
      parsed.dispose?.();
      disposeMmdModel(mmd);
    }
  });
});
