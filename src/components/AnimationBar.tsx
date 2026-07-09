import type { CSSProperties } from "react";
import {
  PauseIcon,
  PlayIcon,
  TrackNextIcon,
  TrackPreviousIcon,
} from "@radix-ui/react-icons";
import { Button, SelectField, SliderField, Tooltip } from "./ui";
import "../styles/animation.css";

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
    <div
      className="animation-bar u-grid u-items-center"
      role="group"
      aria-label="Animation controls"
    >
      <div className="animation-clip u-min-w-0 u-md-hidden">
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

      <div className="animation-primary-controls u-flex u-items-center u-gap-2">
        <Tooltip content="Previous frame" side="top" size="sm">
          <Button
            className="yl-button--unstyled"
            iconOnly
            onClick={() => onStep(-1)}
            size="sm"
            variant="ghost"
          >
            <TrackPreviousIcon aria-hidden="true" />
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
              <PauseIcon aria-hidden="true" />
            ) : (
              <PlayIcon aria-hidden="true" />
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
            <TrackNextIcon aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>

      <SliderField
        aria-label="Animation seek"
        className="animation-seek u-flex u-min-w-0 u-items-center"
        inputClassName="animation-seek-input"
        max={safeDuration || 0}
        min={0}
        onChange={(event) => onSeek(Number(event.target.value))}
        style={{ "--animation-progress": `${progress}%` } as CSSProperties}
        step={Math.max(safeDuration / 300, 1 / 120)}
        value={safeCurrentTime}
      />

      <div className="animation-time-readout u-grid u-gap-6 u-nowrap u-sm-hidden">
        <span>{formatTime(safeCurrentTime)}</span>
        <span className="animation-time-total">{formatTime(safeDuration)}</span>
      </div>
    </div>
  );
}
