import { describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SceneContext } from "../../../types/viewer";
import { createMmdRuntime } from "../runtime";

function createSceneContext(): SceneContext {
  const mesh = new Group();
  const animation = { metadata: { maxFrame: 60 } };
  const mmdLightSync = vi.fn();
  return {
    mmdModel: {
      mesh,
      syncMaterialMorphs: vi.fn(),
      runtime: {
        reset: vi.fn(),
        setAnimation: vi.fn(),
        tick: vi.fn(),
      },
    },
    mmdLightSync,
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
    expect(model.syncMaterialMorphs).toHaveBeenCalledOnce();
    expect(context.mmdLightSync).toHaveBeenCalledOnce();
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
    expect(model.syncMaterialMorphs).toHaveBeenCalledTimes(2);
    expect(context.mmdLightSync).toHaveBeenCalledTimes(2);
  });

  it("resynchronizes the VMD light after loop wrap", () => {
    const context = createSceneContext();
    const runtime = createMmdRuntime(context);

    context.mmdMotion!.currentTime = 1.9;
    runtime.animation?.update(0.2);

    expect(context.mmdModel?.runtime?.reset).toHaveBeenCalledWith(0);
    expect(context.mmdModel?.runtime?.tick).toHaveBeenCalledWith(
      expect.closeTo(0.1),
      {
        mesh: context.mmdModel?.mesh,
        ik: true,
        physics: false,
      },
    );
    expect(context.mmdLightSync).toHaveBeenCalledOnce();
  });

  it("drops the light synchronizer when the pack runtime is disposed", () => {
    const context = createSceneContext();
    const runtime = createMmdRuntime(context);

    runtime.dispose?.();

    expect(context.mmdLightSync).toBeNull();
    expect(context.mmdMotion).toBeNull();
  });
});
