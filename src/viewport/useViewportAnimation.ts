import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { SceneContext } from "../viewer";
import {
  activateClip,
  seekAction,
  setActionPlayback,
  stepAction,
} from "../viewer";
import type { ViewerSurfaceMode } from "../types/viewer";
import type { AnimationState } from "../components/animation";
import { applyMorphTargetValues } from "../components/morphTargets";
import { syncMmdMaterialRenderStates } from "../viewer/mmd/userData";

function retargetMmdMotion(context: SceneContext, seconds: number) {
  const model = context.mmdModel;
  const motion = context.mmdMotion;
  const runtime = model?.runtime;
  if (!model || !motion || !runtime) {
    return;
  }

  runtime.reset(0);
  runtime.setAnimation(motion.animation, model.mesh);
  runtime.tick(seconds, {
    mesh: model.mesh,
    ik: true,
    physics: false,
  });
  syncMmdMaterialRenderStates(model.mesh);
}

function setMmdMotionCurrentTime(context: SceneContext, currentTime: number) {
  if (!context.mmdMotion) {
    return;
  }
  context.mmdMotion = {
    ...context.mmdMotion,
    currentTime,
  };
}

type UseViewportAnimationOptions = {
  animationState: AnimationState;
  setAnimationState: Dispatch<SetStateAction<AnimationState>>;
  sceneContextRef: RefObject<SceneContext | null>;
  morphTargetValuesRef: RefObject<
    Record<string, Record<number, number>> | undefined
  >;
  viewerSurfaceMode: ViewerSurfaceMode;
};

export function useViewportAnimation({
  animationState,
  setAnimationState,
  sceneContextRef,
  morphTargetValuesRef,
  viewerSurfaceMode,
}: UseViewportAnimationOptions) {
  useEffect(() => {
    const context = sceneContextRef.current;

    if (
      (!context?.mixer || context.clips.length === 0) &&
      !context?.mmdMotion
    ) {
      return;
    }

    let animationFrame = 0;
    let previousTimestamp = performance.now();

    const update = (timestamp: number) => {
      animationFrame = window.requestAnimationFrame(update);
      const deltaSeconds = (timestamp - previousTimestamp) / 1000;
      previousTimestamp = timestamp;

      if (animationState.isPlaying && viewerSurfaceMode === "asset") {
        if (context.mmdMotion && context.mmdModel?.runtime) {
          const duration = Math.max(context.mmdMotion.duration, 1 / 30);
          const previousTime = context.mmdMotion.currentTime;
          const nextTime =
            (context.mmdMotion.currentTime + deltaSeconds) % duration;
          const wrapped = nextTime < previousTime;
          if (wrapped) {
            retargetMmdMotion(context, nextTime);
          } else {
            context.mmdModel.runtime.tick(nextTime, {
              mesh: context.mmdModel.mesh,
              ik: true,
              physics: nextTime > 0,
            });
            syncMmdMaterialRenderStates(context.mmdModel.mesh);
          }
          setMmdMotionCurrentTime(context, nextTime);
        } else {
          context.mixer?.update(deltaSeconds);
        }
        if (context.sourceObject) {
          applyMorphTargetValues(
            context.sourceObject,
            morphTargetValuesRef.current,
          );
        }
      }

      const clip = context.clips[animationState.activeClipIndex];
      const action = context.activeAction;
      const nextTime = context.mmdMotion?.currentTime ?? action?.time ?? 0;
      const nextDuration =
        context.mmdMotion?.duration ??
        clip?.duration ??
        animationState.duration;

      setAnimationState((previous) => {
        if (
          previous.activeClipIndex === animationState.activeClipIndex &&
          previous.isPlaying === animationState.isPlaying &&
          Math.abs(previous.currentTime - nextTime) < 1 / 30 &&
          Math.abs(previous.duration - nextDuration) < 1 / 1000
        ) {
          return previous;
        }

        return {
          ...previous,
          currentTime: nextTime,
          duration: nextDuration,
        };
      });
    };

    animationFrame = window.requestAnimationFrame(update);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    animationState.activeClipIndex,
    animationState.duration,
    animationState.isPlaying,
    viewerSurfaceMode,
  ]);

  const hasAnimation = animationState.clipNames.length > 0;

  const handleTogglePlayback = () => {
    const context = sceneContextRef.current;
    const mmdMotion = context?.mmdMotion;
    const action = context?.activeAction;

    if (!context || (!action && !mmdMotion)) {
      return;
    }

    setAnimationState((previous) => {
      const nextIsPlaying = !previous.isPlaying;
      if (action) {
        setActionPlayback(action, nextIsPlaying);
      }
      return {
        ...previous,
        isPlaying: nextIsPlaying,
      };
    });
  };

  const handleSelectClip = (index: number) => {
    const context = sceneContextRef.current;

    if (!context || index < 0 || index >= context.clips.length) {
      return;
    }

    const activated = activateClip(context, index, animationState.isPlaying);

    if (!activated) {
      return;
    }

    setAnimationState((previous) => ({
      ...previous,
      activeClipIndex: activated.clipIndex,
      currentTime: activated.currentTime,
      duration: activated.duration,
      isPlaying: activated.isPlaying,
    }));
  };

  const handleSeek = (time: number) => {
    const context = sceneContextRef.current;
    const mmdMotion = context?.mmdMotion;
    const action = context?.activeAction;

    if (!context || (!action && !mmdMotion)) {
      return;
    }

    if (mmdMotion && context.mmdModel?.runtime) {
      const duration = Math.max(mmdMotion.duration, 1 / 30);
      const nextTime = Math.min(Math.max(time, 0), duration);
      retargetMmdMotion(context, nextTime);

      setMmdMotionCurrentTime(context, nextTime);
      setAnimationState((previous) => ({
        ...previous,
        currentTime: nextTime,
        duration,
      }));
      return;
    }

    if (!action) {
      return;
    }

    const clip = context.clips[animationState.activeClipIndex];
    const duration = clip?.duration ?? animationState.duration;
    const nextTime = seekAction(context, action, time, duration);
    setAnimationState((previous) => ({
      ...previous,
      currentTime: nextTime,
      duration,
    }));
  };

  const handleStep = (direction: -1 | 1) => {
    const context = sceneContextRef.current;
    const mmdMotion = context?.mmdMotion;
    const action = context?.activeAction;

    if (!context || (!action && !mmdMotion)) {
      return;
    }

    if (mmdMotion && context.mmdModel?.runtime) {
      const duration = Math.max(mmdMotion.duration, 1 / 30);
      const nextTime = Math.min(
        Math.max(mmdMotion.currentTime + (1 / 30) * direction, 0),
        duration,
      );
      retargetMmdMotion(context, nextTime);

      setMmdMotionCurrentTime(context, nextTime);
      setAnimationState((previous) => ({
        ...previous,
        currentTime: nextTime,
        duration,
        isPlaying: false,
      }));
      return;
    }

    if (!action) {
      return;
    }

    const clip = context.clips[animationState.activeClipIndex];
    const duration = clip?.duration ?? animationState.duration;
    const nextTime = stepAction(context, action, direction, duration);
    setAnimationState((previous) => ({
      ...previous,
      currentTime: nextTime,
      duration,
      isPlaying: false,
    }));
  };

  return {
    animationState,
    hasAnimation,
    handleSeek,
    handleSelectClip,
    handleStep,
    handleTogglePlayback,
  };
}
