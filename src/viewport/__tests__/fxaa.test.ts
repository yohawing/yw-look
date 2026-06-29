import { describe, expect, it, vi } from "vitest";
import { Vector2 } from "three";
import type { SceneContext } from "../../types/viewer";
import {
  createFxaaComposerState,
  syncFxaaComposerSize,
  type FxaaComposerState,
} from "../fxaa";

describe("syncFxaaComposerSize", () => {
  it("updates composer size and FXAA resolution", () => {
    const setSize = vi.fn();
    const resolution = new Vector2();
    const state = {
      composer: {
        render: vi.fn(),
        setSize,
        dispose: vi.fn(),
      },
      fxaaPass: {
        material: {
          uniforms: {
            resolution: { value: resolution },
          },
        },
      },
      renderPass: { camera: {} },
    } as unknown as FxaaComposerState;

    syncFxaaComposerSize(state, 200, 100, 2);

    expect(setSize).toHaveBeenCalledWith(200, 100);
    expect(resolution.x).toBeCloseTo(1 / 400);
    expect(resolution.y).toBeCloseTo(1 / 200);
  });

  it("skips composer construction when cancelled after imports", async () => {
    const context = {
      renderer: null,
    } as unknown as SceneContext;

    await expect(
      createFxaaComposerState(
        context,
        { clientWidth: 200, clientHeight: 100 },
        { isCancelled: () => true },
      ),
    ).resolves.toBeNull();
  });
});
