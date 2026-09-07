import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { LoopOnce, LoopRepeat } from "three";
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

const MIN_PLAYBACK_RATE = 0.1;
const MAX_PLAYBACK_RATE = 8;
const END_EPSILON = 1e-6;

export type ViewportLoopRange = {
  start: number;
  end: number;
};

type AnimationIdentity = {
  mixer: SceneContext["mixer"];
  clips: SceneContext["clips"] | null;
  packAnimation: NonNullable<SceneContext["packRuntime"]>["animation"] | null;
  mmdMotion: SceneContext["mmdMotion"];
  clipNamesKey: string;
  activeClipIndex: number;
};

function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 1;
  }
  return Math.min(Math.max(rate, MIN_PLAYBACK_RATE), MAX_PLAYBACK_RATE);
}

function normalizeLoopRange(
  range: ViewportLoopRange | null,
  duration: number,
): ViewportLoopRange | null {
  if (
    !range ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end)
  ) {
    return null;
  }

  const start = Math.min(Math.max(range.start, 0), duration);
  const end = Math.min(Math.max(range.end, 0), duration);
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);
  if (normalizedEnd - normalizedStart <= END_EPSILON) {
    return null;
  }

  return { start: normalizedStart, end: normalizedEnd };
}

function advanceLoopTime(
  currentTime: number,
  deltaSeconds: number,
  range: ViewportLoopRange,
  duration: number,
): number {
  const safeCurrentTime = Number.isFinite(currentTime)
    ? Math.min(Math.max(currentTime, 0), duration)
    : range.start;
  const rangeDuration = range.end - range.start;
  const baseTime =
    safeCurrentTime < range.start || safeCurrentTime >= range.end
      ? range.start
      : safeCurrentTime;
  const nextTime = baseTime + Math.max(deltaSeconds, 0);
  if (nextTime < range.end) {
    return nextTime;
  }
  return range.start + ((nextTime - range.start) % rangeDuration);
}

function isWithinLoopRange(time: number, range: ViewportLoopRange): boolean {
  return time >= range.start && time < range.end;
}

function animationDuration(
  context: SceneContext,
  animationState: AnimationState,
): number {
  const packSnapshot = context.packRuntime?.animation?.getSnapshot();
  const clip = context.clips[animationState.activeClipIndex];
  const duration =
    packSnapshot?.duration ?? clip?.duration ?? animationState.duration;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function sameAnimationIdentity(
  left: AnimationIdentity,
  right: AnimationIdentity,
): boolean {
  return (
    left.mixer === right.mixer &&
    left.clips === right.clips &&
    left.packAnimation === right.packAnimation &&
    left.mmdMotion === right.mmdMotion &&
    left.clipNamesKey === right.clipNamesKey &&
    left.activeClipIndex === right.activeClipIndex
  );
}

function configureAction(
  action: NonNullable<SceneContext["activeAction"]>,
  looping: boolean,
  playbackRate: number,
  loopRange: ViewportLoopRange | null = null,
) {
  const rangeLooping = looping && loopRange !== null;
  action.setLoop(
    rangeLooping || !looping ? LoopOnce : LoopRepeat,
    rangeLooping || !looping ? 1 : Infinity,
  );
  action.clampWhenFinished = !looping || rangeLooping;
  action.timeScale = playbackRate;
}

export function useViewportAnimation({
  animationState,
  setAnimationState,
  sceneContextRef,
  morphTargetValuesRef,
  viewerSurfaceMode,
}: UseViewportAnimationOptions) {
  const [looping, setLooping] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loopRange, setLoopRange] = useState<ViewportLoopRange | null>(null);
  const animationIdentityRef = useRef<AnimationIdentity | null>(null);

  useEffect(() => {
    const context = sceneContextRef.current;
    const animationIdentity: AnimationIdentity = {
      mixer: context?.mixer ?? null,
      clips: context?.clips ?? null,
      packAnimation: context?.packRuntime?.animation ?? null,
      mmdMotion: context?.mmdMotion ?? null,
      clipNamesKey: animationState.clipNames.join("\u0000"),
      activeClipIndex: animationState.activeClipIndex,
    };
    const previousIdentity = animationIdentityRef.current;
    if (
      previousIdentity &&
      !sameAnimationIdentity(previousIdentity, animationIdentity)
    ) {
      setLoopRange(null);
    }
    animationIdentityRef.current = animationIdentity;
  }, [animationState, loopRange, looping, playbackRate, sceneContextRef]);

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
      const deltaSeconds = Math.max(0, (timestamp - previousTimestamp) / 1000);
      previousTimestamp = timestamp;

      let stoppedAtEnd = false;
      if (animationState.isPlaying && viewerSurfaceMode === "asset") {
        const clip = context.clips[animationState.activeClipIndex];
        const packSnapshotBefore = packAnimation?.getSnapshot();
        const duration =
          packSnapshotBefore?.duration ??
          clip?.duration ??
          animationState.duration;
        const effectiveLoopRange = looping ? loopRange : null;

        if (packAnimation?.hasAnimation()) {
          const currentTime = packSnapshotBefore?.currentTime ?? 0;
          const scaledDelta = deltaSeconds * playbackRate;
          const nextTime = currentTime + scaledDelta;
          if (!looping && duration > 0 && nextTime >= duration) {
            packAnimation.seek(duration);
            stoppedAtEnd = true;
          } else if (effectiveLoopRange) {
            if (
              !isWithinLoopRange(currentTime, effectiveLoopRange) ||
              nextTime >= effectiveLoopRange.end
            ) {
              packAnimation.seek(
                advanceLoopTime(
                  currentTime,
                  scaledDelta,
                  effectiveLoopRange,
                  duration,
                ),
              );
            } else {
              packAnimation.update(scaledDelta);
            }
          } else {
            packAnimation.update(scaledDelta);
          }
        } else {
          const action = context.activeAction;
          if (action) {
            configureAction(action, looping, playbackRate, effectiveLoopRange);
            if (effectiveLoopRange) {
              const scaledDelta = deltaSeconds * playbackRate;
              const nextTime = action.time + scaledDelta;
              const needsSeek =
                !isWithinLoopRange(action.time, effectiveLoopRange) ||
                nextTime >= effectiveLoopRange.end;
              if (needsSeek) {
                seekAction(
                  context,
                  action,
                  advanceLoopTime(
                    action.time,
                    scaledDelta,
                    effectiveLoopRange,
                    duration,
                  ),
                  duration,
                );
              } else {
                context.mixer?.update(deltaSeconds);
              }
              setActionPlayback(action, animationState.isPlaying);
            } else {
              setActionPlayback(action, animationState.isPlaying);
              context.mixer?.update(deltaSeconds);
            }
          }
          if (
            action &&
            !effectiveLoopRange &&
            !looping &&
            duration > 0 &&
            action.time >= duration - END_EPSILON
          ) {
            action.time = duration;
            action.paused = true;
            stoppedAtEnd = true;
          }
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
          previous.isPlaying ===
            (stoppedAtEnd ? false : animationState.isPlaying) &&
          Math.abs(previous.currentTime - nextTime) < 1 / 30 &&
          Math.abs(previous.duration - nextDuration) < 1 / 1000
        ) {
          return previous;
        }

        return {
          ...previous,
          currentTime: nextTime,
          duration: nextDuration,
          isPlaying: stoppedAtEnd ? false : previous.isPlaying,
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
    loopRange,
    looping,
    playbackRate,
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

    const packSnapshot = packAnimation?.getSnapshot();
    const clip = context.clips[animationState.activeClipIndex];
    const duration =
      packSnapshot?.duration ?? clip?.duration ?? animationState.duration;
    const currentTime =
      packSnapshot?.currentTime ?? action?.time ?? animationState.currentTime;
    const shouldRestart =
      !animationState.isPlaying &&
      duration > 0 &&
      currentTime >= duration - END_EPSILON;

    if (shouldRestart) {
      if (packAnimation?.hasAnimation()) {
        packAnimation.seek(0);
      } else if (action) {
        configureAction(action, looping, playbackRate, loopRange);
        action.reset();
        action.play();
      }
    }

    setAnimationState((previous) => {
      const nextIsPlaying = !previous.isPlaying;
      if (action) {
        configureAction(action, looping, playbackRate, loopRange);
        setActionPlayback(action, nextIsPlaying);
      }
      return {
        ...previous,
        isPlaying: nextIsPlaying,
        ...(shouldRestart ? { currentTime: 0 } : {}),
      };
    });
  };

  const handleSetLooping = (nextLooping: boolean) => {
    setLooping(nextLooping);
    const action = sceneContextRef.current?.activeAction;
    if (action) {
      configureAction(action, nextLooping, playbackRate, loopRange);
      setActionPlayback(action, animationState.isPlaying);
    }
  };

  const handleSetPlaybackRate = (nextRate: number) => {
    const safeRate = clampPlaybackRate(nextRate);
    setPlaybackRate(safeRate);
    const action = sceneContextRef.current?.activeAction;
    if (action) {
      configureAction(action, looping, safeRate, loopRange);
    }
  };

  const handleSetLoopRange = (nextRange: ViewportLoopRange | null) => {
    const context = sceneContextRef.current;
    const duration = context
      ? animationDuration(context, animationState)
      : animationState.duration;
    const normalizedRange = normalizeLoopRange(nextRange, duration);
    setLoopRange(normalizedRange);

    const action = context?.activeAction;
    if (action) {
      configureAction(action, looping, playbackRate, normalizedRange);
      setActionPlayback(action, animationState.isPlaying);
    }
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

    if (context.activeAction) {
      configureAction(context.activeAction, looping, playbackRate, loopRange);
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

  useEffect(() => {
    if (!hasAnimation || viewerSurfaceMode !== "asset") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isInteractiveKeyboardTarget(event.target)
      ) {
        return;
      }

      const isSpace =
        event.key === " " ||
        event.key === "Spacebar" ||
        event.key === "Space" ||
        event.code === "Space";
      const stepDirection =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
      if ((!isSpace && stepDirection === null) || (isSpace && event.repeat)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (isSpace) {
        handleTogglePlayback();
      } else {
        handleStep(stepDirection as -1 | 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleStep, handleTogglePlayback, hasAnimation, viewerSurfaceMode]);

  return {
    animationState,
    hasAnimation,
    handleSeek,
    handleSelectClip,
    handleStep,
    handleSetLooping,
    handleSetLoopRange,
    handleSetPlaybackRate,
    handleTogglePlayback,
    looping,
    loopRange,
    playbackRate,
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

function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, select, textarea, button, a[href], dialog, [role='dialog'], [role='button'], [role='textbox'], [role='combobox'], [role='listbox'], [role='slider'], [role='tree'], [contenteditable]:not([contenteditable='false'])",
    ),
  );
}
