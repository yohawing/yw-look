export type AnimationState = {
  clipNames: string[];
  activeClipIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
};

export const emptyAnimationState: AnimationState = {
  clipNames: [],
  activeClipIndex: 0,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
};
