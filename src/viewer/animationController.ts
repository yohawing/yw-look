import type { AnimationAction, AnimationClip } from "three";
import type { SceneContext } from "./types";

export function getClipLabel(clip: AnimationClip, index: number) {
  const normalized = clip.name.trim();
  return normalized.length > 0 ? normalized : `Clip ${index + 1}`;
}

export function activateClip(
  context: SceneContext,
  clipIndex: number,
  shouldPlay: boolean,
) {
  if (!context.mixer) {
    return null;
  }

  const clip = context.clips[clipIndex];
  if (!clip) {
    return null;
  }

  context.activeAction?.stop();
  const nextAction = context.mixer.clipAction(clip);
  nextAction.reset();
  nextAction.paused = !shouldPlay;
  nextAction.play();
  context.activeAction = nextAction;

  return {
    clipIndex,
    duration: clip.duration,
    currentTime: 0,
    isPlaying: shouldPlay,
  };
}

export function setActionPlayback(action: AnimationAction, isPlaying: boolean) {
  action.paused = !isPlaying;
}

export function seekAction(
  context: SceneContext,
  action: AnimationAction,
  time: number,
  duration: number,
) {
  const nextTime = Math.min(Math.max(time, 0), duration);
  action.time = nextTime;
  context.mixer?.update(0);
  return nextTime;
}

export function stepAction(
  context: SceneContext,
  action: AnimationAction,
  direction: -1 | 1,
  duration: number,
) {
  action.paused = true;
  const frameDuration = 1 / 30;
  const nextTime = Math.min(
    Math.max(action.time + frameDuration * direction, 0),
    duration,
  );
  action.time = nextTime;
  context.mixer?.update(0);
  return nextTime;
}
