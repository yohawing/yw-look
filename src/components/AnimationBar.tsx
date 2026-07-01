import type { CSSProperties } from "react";
import { Button, SelectField, SliderField, Tooltip } from "./ui";

type AnimationBarProps = {
  clipNames: string[];
  activeClipIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSelectClip: (index: number) => void;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  onStep: (direction: -1 | 1) => void;
};

function formatTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const centiseconds = Math.floor((safeSeconds % 1) * 100);

  return `${minutes}:${wholeSeconds.toString().padStart(2, "0")}.${centiseconds
    .toString()
    .padStart(2, "0")}`;
}

export function AnimationBar({
  clipNames,
  activeClipIndex,
  currentTime,
  duration,
  isPlaying,
  onSelectClip,
  onTogglePlayback,
  onSeek,
  onStep,
}: AnimationBarProps) {
  const safeDuration = duration > 0 ? duration : 0;
  const safeCurrentTime = Math.min(Math.max(currentTime, 0), safeDuration);
  const activeClipName = clipNames[activeClipIndex] ?? "Animation";
  const progress =
    safeDuration > 0 ? (safeCurrentTime / safeDuration) * 100 : 0;

  return (
    <div className="animation-bar" role="group" aria-label="Animation controls">
      <div className="animation-clip">
        {clipNames.length > 1 ? (
          <SelectField
            aria-label="Animation clip"
            onChange={(event) => onSelectClip(Number(event.target.value))}
            size="sm"
            value={activeClipIndex}
          >
            {clipNames.map((clipName, index) => (
              <option key={`${clipName}-${index}`} value={index}>
                {clipName}
              </option>
            ))}
          </SelectField>
        ) : (
          <Tooltip content={activeClipName} side="top" size="sm">
            <span>{activeClipName}</span>
          </Tooltip>
        )}
      </div>

      <div className="animation-primary-controls">
        <Tooltip content="Previous frame" side="top" size="sm">
          <Button
            className="yl-button--unstyled"
            iconOnly
            onClick={() => onStep(-1)}
            size="sm"
            variant="ghost"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10 2.5L5 7l5 4.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
              <path
                d="M4 3v8"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.5"
              />
            </svg>
          </Button>
        </Tooltip>
        <Tooltip content={isPlaying ? "Pause" : "Play"} side="top" size="sm">
          <Button
            className="yl-button--unstyled animation-play-button"
            iconOnly
            onClick={onTogglePlayback}
            size="sm"
            variant="primary"
          >
            {isPlaying ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="4" y="3" width="3" height="10" rx="0.5" />
                <rect x="9" y="3" width="3" height="10" rx="0.5" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M5 3l8 5-8 5V3Z" />
              </svg>
            )}
          </Button>
        </Tooltip>
        <Tooltip content="Next frame" side="top" size="sm">
          <Button
            className="yl-button--unstyled"
            iconOnly
            onClick={() => onStep(1)}
            size="sm"
            variant="ghost"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 2.5L9 7l-5 4.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
              <path
                d="M10 3v8"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.5"
              />
            </svg>
          </Button>
        </Tooltip>
      </div>

      <SliderField
        aria-label="Animation seek"
        className="animation-seek"
        inputClassName="animation-seek-input"
        max={safeDuration || 0}
        min={0}
        onChange={(event) => onSeek(Number(event.target.value))}
        style={{ "--animation-progress": `${progress}%` } as CSSProperties}
        step={Math.max(safeDuration / 300, 1 / 120)}
        value={safeCurrentTime}
      />

      <div className="animation-time-readout">
        <span>{formatTime(safeCurrentTime)}</span>
        <span className="animation-time-total">{formatTime(safeDuration)}</span>
      </div>
    </div>
  );
}
