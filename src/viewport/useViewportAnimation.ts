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
import type { AnimationState, ViewerSurfaceMode } from "../types/viewer";
import {
  applyMorphTargetValues,
  morphTargetValuesForObject,
} from "../viewer/morphTargets";

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

    if (!context) {
      return;
    }

    const packAnimation = context?.packRuntime?.animation;
    if (
      (!context.mixer || context.clips.length === 0) &&
      !packAnimation?.hasAnimation()
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
        if (packAnimation?.hasAnimation()) {
          packAnimation.update(deltaSeconds);
        } else {
          context.mixer?.update(deltaSeconds);
        }
        if (context.sourceObject) {
          const morphOverrides = morphTargetValuesRef.current;
          applyMorphTargetValues(context.sourceObject, morphOverrides);
          if (hasMorphOverrides(morphOverrides)) {
            const mmdModel = context.mmdModel;
            mmdModel?.syncMaterialMorphs?.(
              morphTargetValuesForObject(mmdModel.mesh, morphOverrides),
            );
          }
        }
      }

      const clip = context.clips[animationState.activeClipIndex];
      const action = context.activeAction;
      const packSnapshot = packAnimation?.getSnapshot();
      const nextTime = packSnapshot?.currentTime ?? action?.time ?? 0;
      const nextDuration =
        packSnapshot?.duration ?? clip?.duration ?? animationState.duration;

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
    const packAnimation = context?.packRuntime?.animation;
    const action = context?.activeAction;

    if (!context || (!action && !packAnimation?.hasAnimation())) {
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
    const packAnimation = context?.packRuntime?.animation;
    const action = context?.activeAction;

    if (!context || (!action && !packAnimation?.hasAnimation())) {
      return;
    }

    const packSnapshot = packAnimation?.seek(time);
    if (packSnapshot) {
      setAnimationState((previous) => ({
        ...previous,
        currentTime: packSnapshot.currentTime,
        duration: packSnapshot.duration,
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
    const packAnimation = context?.packRuntime?.animation;
    const action = context?.activeAction;

    if (!context || (!action && !packAnimation?.hasAnimation())) {
      return;
    }

    const packSnapshot = packAnimation?.step(direction);
    if (packSnapshot) {
      setAnimationState((previous) => ({
        ...previous,
        currentTime: packSnapshot.currentTime,
        duration: packSnapshot.duration,
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

function hasMorphOverrides(
  values: Record<string, Record<number, number>> | undefined,
): boolean {
  if (!values) return false;
  return Object.values(values).some(
    (targetValues) => Object.keys(targetValues).length > 0,
  );
}
