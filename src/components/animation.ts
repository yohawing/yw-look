import type { AnimationState } from "../types/viewer";

export type { AnimationState } from "../types/viewer";

export const emptyAnimationState: AnimationState = {
  clipNames: [],
  activeClipIndex: 0,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
};
