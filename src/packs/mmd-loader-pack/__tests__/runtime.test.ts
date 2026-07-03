import { describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SceneContext } from "../../../types/viewer";
import { createMmdRuntime } from "../runtime";

function createSceneContext(): SceneContext {
  const mesh = new Group();
  const animation = { metadata: { maxFrame: 60 } };
  return {
    mmdModel: {
      mesh,
      runtime: {
        reset: vi.fn(),
        setAnimation: vi.fn(),
        tick: vi.fn(),
      },
    },
    mmdMotion: {
      animation,
      duration: 2,
      currentTime: 0,
      label: "motion.vmd",
    },
  } as unknown as SceneContext;
}

describe("createMmdRuntime", () => {
  it("advances MMD motion through the pack runtime animation hook", () => {
    const context = createSceneContext();
    const runtime = createMmdRuntime(context);
    const model = context.mmdModel!;

    runtime.animation?.update(0.5);

    expect(model.runtime?.tick).toHaveBeenCalledWith(0.5, {
      mesh: model.mesh,
      ik: true,
      physics: false,
    });
    expect(runtime.animation?.getSnapshot()).toEqual({
      currentTime: 0.5,
      duration: 2,
    });
  });

  it("retargets MMD motion when seeking and stepping", () => {
    const context = createSceneContext();
    const runtime = createMmdRuntime(context);
    const model = context.mmdModel!;

    expect(runtime.animation?.seek(1.25)).toEqual({
      currentTime: 1.25,
      duration: 2,
    });
    expect(model.runtime?.reset).toHaveBeenCalledWith(0);
    expect(model.runtime?.setAnimation).toHaveBeenCalledWith(
      context.mmdMotion?.animation,
      model.mesh,
    );
    expect(runtime.animation?.step(1)).toEqual({
      currentTime: 1.25 + 1 / 30,
      duration: 2,
    });
  });
});
