import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  TimelineEditor,
  type TimelineDataSource,
  type TimelinePlaybackCommand,
  type TimelinePlaybackController,
  type TimelinePlaybackSnapshot,
} from "@yohawing/timeline-editor";
import "@yohawing/timeline-editor/styles.css";
import "../styles/playback-timeline.css";

const PLAYBACK_FRAME_RATE = 30;

type PlaybackTimelineProps = {
  activeClipIndex: number;
  clipName: string;
  currentTime: number;
  duration: number;
  /** Absolute display origin; runtime times and loop bounds remain local. */
  rangeStart?: number;
  isPlaying: boolean;
  looping: boolean;
  loopRange: { start: number; end: number } | null;
  playbackRate: number;
  onSeek: (time: number) => void;
  onTogglePlayback: () => void;
  onSetLooping: (looping: boolean) => void;
  onSetLoopRange: (range: { start: number; end: number } | null) => void;
  onSetPlaybackRate: (rate: number) => void;
  clipSelector?: ReactNode;
};

function safeDuration(duration: number) {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function clampTime(time: number, duration: number) {
  if (!Number.isFinite(time)) return 0;
  return Math.min(Math.max(time, 0), duration);
}

function normalizeLoopRange(
  range: { start: number; end: number } | null | undefined,
  duration: number,
) {
  if (!range) return null;
  const start = clampTime(range.start, duration);
  const end = clampTime(range.end, duration);
  return end > start ? { start, end } : null;
}

type PlaybackControllerState = {
  currentTime: number;
  duration: number;
  rangeStart: number;
  isPlaying: boolean;
  looping: boolean;
  loopRange: { start: number; end: number } | null;
  playbackRate: number;
  onSeek: (time: number) => void;
  onTogglePlayback: () => void;
  onSetLooping: (looping: boolean) => void;
  onSetLoopRange: (range: { start: number; end: number } | null) => void;
  onSetPlaybackRate: (rate: number) => void;
};

type PlaybackControllerAdapter = TimelinePlaybackController & {
  update: (state: PlaybackControllerState) => void;
};

function createPlaybackController(
  initialState: PlaybackControllerState,
): PlaybackControllerAdapter {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: (): TimelinePlaybackSnapshot => {
      const safeDurationValue = safeDuration(state.duration);
      const start = state.rangeStart;
      const loop = normalizeLoopRange(state.loopRange, safeDurationValue);
      return {
        range: { start, end: start + safeDurationValue },
        available: safeDurationValue > 0,
        time: start + clampTime(state.currentTime, safeDurationValue),
        duration: safeDurationValue,
        playing: safeDurationValue > 0 && state.isPlaying,
        looping: state.looping,
        loopRange: loop
          ? { start: start + loop.start, end: start + loop.end }
          : null,
        rate: state.playbackRate,
        target: null,
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (command: TimelinePlaybackCommand) => {
      switch (command.type) {
        case "seek":
          state.onSeek(
            clampTime(
              command.time - state.rangeStart,
              safeDuration(state.duration),
            ),
          );
          break;
        case "play":
          if (!state.isPlaying) state.onTogglePlayback();
          break;
        case "pause":
          if (state.isPlaying) state.onTogglePlayback();
          break;
        case "setLooping":
          state.onSetLooping(command.looping);
          break;
        case "setLoopRange":
          {
            const onSetLoopRange = state.onSetLoopRange;
            const nextRange = normalizeLoopRange(
              command.range
                ? {
                    start: command.range.start - state.rangeStart,
                    end: command.range.end - state.rangeStart,
                  }
                : null,
              safeDuration(state.duration),
            );
            queueMicrotask(() => onSetLoopRange(nextRange));
          }
          break;
        case "setRate":
          state.onSetPlaybackRate(command.rate);
          break;
        default:
          break;
      }
    },
    update: (nextState) => {
      const changed =
        state.currentTime !== nextState.currentTime ||
        state.duration !== nextState.duration ||
        state.rangeStart !== nextState.rangeStart ||
        state.isPlaying !== nextState.isPlaying ||
        state.looping !== nextState.looping ||
        state.loopRange?.start !== nextState.loopRange?.start ||
        state.loopRange?.end !== nextState.loopRange?.end ||
        state.playbackRate !== nextState.playbackRate;
      state = nextState;
      if (changed) listeners.forEach((listener) => listener());
    },
  };
}

function usePlaybackController(state: PlaybackControllerState) {
  const [playbackController] = useState<PlaybackControllerAdapter>(() =>
    createPlaybackController(state),
  );

  useLayoutEffect(() => {
    playbackController.update(state);
  }, [playbackController, state]);

  return playbackController;
}

function usePlaybackDataSource(duration: number, rangeStart: number) {
  const safeDurationValue = safeDuration(duration);
  return useMemo<TimelineDataSource>(
    () => ({
      subscribe: () => () => undefined,
      getRevision: () => 1,
      getDomain: () => ({ kind: "seconds" }),
      getRange: () => ({
        start: rangeStart,
        end: rangeStart + safeDurationValue,
      }),
      getGroups: () => [],
      getBindings: () => [],
      getRowCount: () => 0,
      getRows: () => [],
      getItems: () => [],
      getKeys: () => [],
    }),
    [safeDurationValue, rangeStart],
  );
}

export function PlaybackTimeline({
  activeClipIndex,
  clipName,
  currentTime,
  duration,
  rangeStart = 0,
  isPlaying,
  looping,
  loopRange,
  playbackRate,
  onSeek,
  onTogglePlayback,
  onSetLooping,
  onSetLoopRange,
  onSetPlaybackRate,
  clipSelector,
}: PlaybackTimelineProps) {
  const safeDurationValue = safeDuration(duration);
  const dataSource = usePlaybackDataSource(
    safeDurationValue,
    Number.isFinite(rangeStart) ? rangeStart : 0,
  );
  const playbackController = usePlaybackController({
    currentTime,
    duration: safeDurationValue,
    rangeStart: Number.isFinite(rangeStart) ? rangeStart : 0,
    isPlaying,
    looping,
    loopRange,
    playbackRate,
    onSeek,
    onTogglePlayback,
    onSetLooping,
    onSetLoopRange,
    onSetPlaybackRate,
  });

  return (
    <div className="playback-timeline">
      <TimelineEditor
        key={`${activeClipIndex}:${clipName}`}
        dataSource={dataSource}
        displayMode="frames"
        frameRate={PLAYBACK_FRAME_RATE}
        playbackController={playbackController}
        showTitle={false}
        slots={{ toolbarStart: clipSelector }}
      />
    </div>
  );
}
