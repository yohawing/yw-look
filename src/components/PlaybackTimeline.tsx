import { useCallback, useLayoutEffect, useMemo, useState } from "react";
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
  onSeek: (time: number) => void;
};

function safeDuration(duration: number) {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function frameCount(duration: number) {
  return Math.ceil(safeDuration(duration) * PLAYBACK_FRAME_RATE);
}

function clampFrame(frame: number, totalFrames: number) {
  if (!Number.isFinite(frame)) return 0;
  return Math.min(Math.max(Math.round(frame), 0), totalFrames);
}

function frameToTime(frame: number, duration: number) {
  const safeDurationValue = safeDuration(duration);
  const totalFrames = frameCount(safeDurationValue);
  const safeFrame = clampFrame(frame, totalFrames);
  return safeDurationValue > 0
    ? Math.min(safeFrame / PLAYBACK_FRAME_RATE, safeDurationValue)
    : 0;
}

function playbackTimeToFrame(time: number, duration: number) {
  const safeDurationValue = safeDuration(duration);
  const totalFrames = frameCount(safeDurationValue);
  if (!Number.isFinite(time)) return 0;
  if (safeDurationValue > 0 && time >= safeDurationValue) return totalFrames;
  return clampFrame(time * PLAYBACK_FRAME_RATE, totalFrames);
}

function clampTime(time: number, duration: number) {
  if (!Number.isFinite(time)) return 0;
  return Math.min(Math.max(time, 0), duration);
}

/** Keep the package adapter stable while the host publishes frame samples. */
type PlaybackControllerState = {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
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
      return {
        available: safeDurationValue > 0,
        time: clampTime(state.currentTime, safeDurationValue),
        duration: safeDurationValue,
        playing: false,
        looping: false,
        target: null,
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (command: TimelinePlaybackCommand) => {
      if (command.type !== "seek") return;
      state.onSeek(clampTime(command.time, safeDuration(state.duration)));
    },
    update: (nextState) => {
      const changed =
        state.currentTime !== nextState.currentTime ||
        state.duration !== nextState.duration;
      state = nextState;
      if (changed) listeners.forEach((listener) => listener());
    },
  };
}

function usePlaybackController(
  currentTime: number,
  duration: number,
  onSeek: (time: number) => void,
) {
  const [playbackController] = useState<PlaybackControllerAdapter>(() =>
    createPlaybackController({ currentTime, duration, onSeek }),
  );

  useLayoutEffect(() => {
    playbackController.update({ currentTime, duration, onSeek });
  }, [currentTime, duration, onSeek, playbackController]);

  return playbackController;
}

function usePlaybackDataSource(duration: number) {
  const safeDurationValue = safeDuration(duration);
  return useMemo<TimelineDataSource>(
    () => ({
      subscribe: () => () => undefined,
      getRevision: () => 1,
      getDomain: () => ({ kind: "seconds" }),
      getRange: () => ({ start: 0, end: safeDurationValue }),
      getGroups: () => [],
      getBindings: () => [],
      getRowCount: () => 0,
      getRows: () => [],
      getItems: () => [],
      getKeys: () => [],
    }),
    [safeDurationValue],
  );
}

export function PlaybackTimeline({
  activeClipIndex,
  clipName,
  currentTime,
  duration,
  onSeek,
}: PlaybackTimelineProps) {
  const safeDurationValue = safeDuration(duration);
  const totalFrames = frameCount(safeDurationValue);
  const currentFrame = playbackTimeToFrame(currentTime, safeDurationValue);
  const clipKey = `${activeClipIndex}:${clipName}`;
  const hasDuration = safeDurationValue > 0;
  const dataSource = usePlaybackDataSource(safeDurationValue);
  const playbackController = usePlaybackController(
    currentTime,
    safeDurationValue,
    onSeek,
  );

  const seekFrame = useCallback(
    (frame: number) => {
      if (!hasDuration) return;
      onSeek(frameToTime(frame, safeDurationValue));
    },
    [hasDuration, onSeek, safeDurationValue],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      let frame: number | undefined;
      switch (event.key) {
        case "ArrowLeft":
          frame = currentFrame - 1;
          break;
        case "ArrowRight":
          frame = currentFrame + 1;
          break;
        case "Home":
          frame = 0;
          break;
        case "End":
          frame = totalFrames;
          break;
        default:
          return;
      }

      event.preventDefault();
      event.stopPropagation();
      seekFrame(frame);
    },
    [currentFrame, seekFrame, totalFrames],
  );

  return (
    <div
      aria-disabled={!hasDuration}
      aria-label="Animation seek"
      aria-valuemax={totalFrames}
      aria-valuemin={0}
      aria-valuenow={currentFrame}
      aria-valuetext={`${currentFrame}f / ${totalFrames}f`}
      className="playback-timeline"
      data-frame-rate={PLAYBACK_FRAME_RATE}
      data-total-frames={totalFrames}
      onKeyDown={handleKeyDown}
      role="slider"
      tabIndex={hasDuration ? 0 : -1}
    >
      <TimelineEditor
        key={clipKey}
        className="playback-timeline-editor"
        dataSource={dataSource}
        displayMode="frames"
        frameRate={PLAYBACK_FRAME_RATE}
        playbackController={playbackController}
        showTitle={false}
        variant="compact"
      />
    </div>
  );
}
