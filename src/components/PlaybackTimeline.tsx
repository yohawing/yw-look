import { useCallback, useEffect, useMemo, useRef } from "react";
import { Timeline, type TimelineState } from "@xzdarcy/react-timeline-editor";
import "../styles/playback-timeline.css";

const PLAYBACK_FRAME_RATE = 30;

const SCALE_WIDTH = 120;
const SCALE_FRAMES = PLAYBACK_FRAME_RATE;
const SCALE_SPLIT_COUNT = 10;
const START_LEFT = 28;
const TIMELINE_ROW_HEIGHT = 26;

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

export function PlaybackTimeline({
  activeClipIndex,
  clipName,
  currentTime,
  duration,
  onSeek,
}: PlaybackTimelineProps) {
  const timelineRef = useRef<TimelineState>(null);
  const safeDurationValue = safeDuration(duration);
  const totalFrames = frameCount(safeDurationValue);
  const currentFrame = playbackTimeToFrame(currentTime, safeDurationValue);
  const clipKey = `${activeClipIndex}:${clipName}`;
  const hasDuration = safeDurationValue > 0;

  const seekFrame = useCallback(
    (frame: number) => {
      if (!hasDuration) return;
      onSeek(frameToTime(frame, safeDurationValue));
    },
    [hasDuration, onSeek, safeDurationValue],
  );

  const handleCursorDragEnd = useCallback(
    (frame: number) => {
      const roundedFrame = clampFrame(frame, totalFrames);
      timelineRef.current?.setTime(roundedFrame);
      seekFrame(roundedFrame);
    },
    [seekFrame, totalFrames],
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
          seekFrame(totalFrames);
          break;
        default:
          return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof frame !== "undefined") seekFrame(frame);
    },
    [currentFrame, seekFrame, totalFrames],
  );

  const editorData = useMemo(
    () => [
      {
        id: "playback-row",
        rowHeight: TIMELINE_ROW_HEIGHT,
        actions: [
          {
            id: "playback-action",
            start: 0,
            end: totalFrames,
            effectId: "playback",
            maxEnd: totalFrames,
            movable: false,
            flexible: false,
          },
        ],
      },
    ],
    [totalFrames],
  );

  useEffect(() => {
    const timeline = timelineRef.current;
    timeline?.setTime(currentFrame);
    if (!timeline || !hasDuration) return;
    if (currentFrame === 0) {
      timeline.setScrollLeft(0);
      return;
    }

    const root = timeline.target;
    const editGrid = root?.querySelector(
      ".timeline-editor-edit-area .ReactVirtualized__Grid",
    ) as HTMLElement | null;
    if (!editGrid || editGrid.clientWidth <= 0) return;

    const cursorPosition =
      START_LEFT + (currentFrame / SCALE_FRAMES) * SCALE_WIDTH;
    const viewportStart = editGrid.scrollLeft;
    const viewportEnd = viewportStart + editGrid.clientWidth;
    const followMargin = 20;
    if (cursorPosition < viewportStart + followMargin) {
      timeline.setScrollLeft(Math.max(0, cursorPosition - followMargin));
    } else if (cursorPosition > viewportEnd - followMargin) {
      timeline.setScrollLeft(
        Math.max(0, cursorPosition - editGrid.clientWidth + followMargin),
      );
    }
  }, [clipKey, currentFrame, hasDuration, totalFrames]);

  const maxScaleCount = Math.max(1, Math.ceil(totalFrames / SCALE_FRAMES) + 2);

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
      <Timeline
        key={clipKey}
        autoReRender={false}
        autoScroll={false}
        disableDrag
        editorData={editorData}
        effects={{}}
        enableRowDrag={false}
        getActionRender={() => (
          <span className="playback-timeline-action-label">{clipName}</span>
        )}
        getScaleRender={(frame) => `${Math.round(frame)}f`}
        maxScaleCount={maxScaleCount}
        minScaleCount={1}
        onChange={() => false}
        onClickActionOnly={(_event, { time }) => {
          seekFrame(time);
        }}
        onClickTimeArea={(time) => {
          seekFrame(time);
          return false;
        }}
        onCursorDrag={seekFrame}
        onCursorDragEnd={handleCursorDragEnd}
        rowHeight={TIMELINE_ROW_HEIGHT}
        scale={SCALE_FRAMES}
        scaleSplitCount={SCALE_SPLIT_COUNT}
        scaleWidth={SCALE_WIDTH}
        startLeft={START_LEFT}
        ref={timelineRef}
      />
    </div>
  );
}
