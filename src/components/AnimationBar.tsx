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
          <button
            onClick={() => onStep(-1)}
            type="button"
            title="Previous frame"
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
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M4 3v8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className="animation-play-button"
            onClick={onTogglePlayback}
            type="button"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="4"
                  y="3"
                  width="3"
                  height="10"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="9"
                  y="3"
                  width="3"
                  height="10"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M5 3l8 5-8 5V3Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button onClick={() => onStep(1)} type="button" title="Next frame">
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
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 3v8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {clipNames.length > 1 ? (
          <label className="animation-clip-select">
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
        ) : null}

        <div className="animation-time-readout">
          <span>{formatTime(safeCurrentTime)}</span>
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
