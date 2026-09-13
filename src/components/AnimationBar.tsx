import { t, useLocale } from "../lib/i18n";
import { SelectField } from "./ui";
import { PlaybackTimeline } from "./PlaybackTimeline";
import "../styles/animation.css";

type AnimationBarProps = {
  clipNames: string[];
  activeClipIndex: number;
  currentTime: number;
  duration: number;
  rangeStart?: number;
  isPlaying: boolean;
  onSelectClip: (index: number) => void;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  looping: boolean;
  loopRange: { start: number; end: number } | null;
  playbackRate: number;
  onSetLooping: (looping: boolean) => void;
  onSetLoopRange: (range: { start: number; end: number } | null) => void;
  onSetPlaybackRate: (rate: number) => void;
};

export function AnimationBar({
  clipNames,
  activeClipIndex,
  currentTime,
  duration,
  rangeStart,
  isPlaying,
  onSelectClip,
  onTogglePlayback,
  onSeek,
  looping,
  loopRange,
  playbackRate,
  onSetLooping,
  onSetLoopRange,
  onSetPlaybackRate,
}: AnimationBarProps) {
  useLocale();
  const clipSelector = (
    <SelectField
      aria-label={t("animation_clip")}
      className="animation-clip-selector"
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
  );

  return (
    <div
      className="animation-bar"
      role="group"
      aria-label={t("animation_controls")}
    >
      <PlaybackTimeline
        activeClipIndex={activeClipIndex}
        clipName={clipNames[activeClipIndex] ?? t("animation_unnamed_clip")}
        clipSelector={clipSelector}
        currentTime={currentTime}
        duration={duration}
        rangeStart={rangeStart}
        isPlaying={isPlaying}
        looping={looping}
        loopRange={loopRange}
        onSeek={onSeek}
        onSetLooping={onSetLooping}
        onSetLoopRange={onSetLoopRange}
        onSetPlaybackRate={onSetPlaybackRate}
        onTogglePlayback={onTogglePlayback}
        playbackRate={playbackRate}
      />
    </div>
  );
}
