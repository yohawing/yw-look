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

  return (
    <div className="animation-bar" role="group" aria-label="Animation controls">
      <div className="animation-bar-row">
        <div className="animation-primary-controls">
          <button onClick={() => onStep(-1)} type="button">
            Frame -
          </button>
          <button onClick={onTogglePlayback} type="button">
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button onClick={() => onStep(1)} type="button">
            Frame +
          </button>
        </div>

        <label className="animation-clip-select">
          <span>Clip</span>
          <select
            onChange={(event) => onSelectClip(Number(event.target.value))}
            value={activeClipIndex}
          >
            {clipNames.map((clipName, index) => (
              <option key={`${clipName}-${index}`} value={index}>
                {clipName}
              </option>
            ))}
          </select>
        </label>

        <div className="animation-time-readout">
          <span>{formatTime(safeCurrentTime)}</span>
          <span>/</span>
          <span>{formatTime(safeDuration)}</span>
        </div>
      </div>

      <label className="animation-seek">
        <span className="sr-only">Animation seek</span>
        <input
          max={safeDuration || 0}
          min={0}
          onChange={(event) => onSeek(Number(event.target.value))}
          step={Math.max(safeDuration / 300, 1 / 120)}
          type="range"
          value={safeCurrentTime}
        />
      </label>
    </div>
  );
}
