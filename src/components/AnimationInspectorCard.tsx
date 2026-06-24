import { useState } from "react";
import type { AnimationClipMetadata } from "../types/viewer";
import { SidebarEmpty, SidebarSection } from "./sidebarPrimitives";

type AnimationInspectorCardProps = {
  clips: AnimationClipMetadata[];
};

function fmtSeconds(value: number): string {
  return `${value.toFixed(3)}s`;
}

function fmtNumber(value: number): string {
  return Intl.NumberFormat("en-US").format(value);
}

function fmtFps(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return `${value.toFixed(2).replace(/\.?0+$/, "")} fps`;
}

function fmtTimeRange(range: readonly [number, number]): string {
  return `${range[0].toFixed(3)} - ${range[1].toFixed(3)}s`;
}

function AnimationTrackDetails({ clip }: { clip: AnimationClipMetadata }) {
  if (clip.tracks.length === 0) {
    return <SidebarEmpty>No animation tracks found.</SidebarEmpty>;
  }

  return (
    <div className="animation-inspector-track-list">
      {clip.tracks.map((track, index) => (
        <details
          className="animation-inspector-track"
          key={`${track.name}:${index}`}
        >
          <summary className="animation-inspector-track-summary">
            <span className="animation-inspector-track-name" title={track.name}>
              {track.name}
            </span>
            <span className="animation-inspector-track-meta">
              {fmtNumber(track.keyframeCount)} keys
            </span>
          </summary>
          <table className="mat-slot-table animation-inspector-track-table">
            <tbody>
              <tr className="mat-slot-row">
                <td className="mat-slot-label">Target</td>
                <td
                  className="mat-slot-value animation-inspector-ellipsis"
                  title={track.target}
                >
                  {track.target}
                </td>
              </tr>
              <tr className="mat-slot-row">
                <td className="mat-slot-label">Property</td>
                <td
                  className="mat-slot-value animation-inspector-ellipsis"
                  title={track.propertyPath}
                >
                  {track.propertyPath}
                </td>
              </tr>
              <tr className="mat-slot-row">
                <td className="mat-slot-label">Keys</td>
                <td className="mat-slot-value animation-inspector-mono">
                  {fmtNumber(track.keyframeCount)}
                </td>
              </tr>
              <tr className="mat-slot-row">
                <td className="mat-slot-label">Time Range</td>
                <td className="mat-slot-value animation-inspector-mono">
                  {fmtTimeRange(track.timeRange)}
                </td>
              </tr>
              <tr className="mat-slot-row">
                <td className="mat-slot-label">Interpolation</td>
                <td className="mat-slot-value">
                  <span className="sidebar-chip">{track.interpolation}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

function AnimationClipDetailPanel({ clip }: { clip: AnimationClipMetadata }) {
  return (
    <section
      aria-label="Selected animation clip"
      className="animation-inspector-selected-panel material-selected-panel"
    >
      <p className="material-selected-title" title={clip.name}>
        {clip.name}
      </p>
      <dl className="material-detail-grid">
        <div className="material-detail-row">
          <dt>Duration</dt>
          <dd>{fmtSeconds(clip.duration)}</dd>
        </div>
        <div className="material-detail-row">
          <dt>Tracks</dt>
          <dd>{fmtNumber(clip.trackCount)}</dd>
        </div>
        <div className="material-detail-row">
          <dt>Total keys</dt>
          <dd>{fmtNumber(clip.keyframeCount)}</dd>
        </div>
        <div className="material-detail-row">
          <dt>Estimated FPS</dt>
          <dd className={clip.estimatedFrameRate === null ? "muted-value" : ""}>
            {fmtFps(clip.estimatedFrameRate)}
          </dd>
        </div>
      </dl>
      <AnimationTrackDetails clip={clip} />
    </section>
  );
}

export function AnimationInspectorCard({ clips }: AnimationInspectorCardProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex =
    clips.length > 0 ? Math.min(selectedIndex, clips.length - 1) : -1;
  const selectedClip = activeIndex >= 0 ? clips[activeIndex] : null;

  return (
    <SidebarSection title="Animation Inspector" count={clips.length}>
      {clips.length > 0 ? (
        <>
          <ul className="animation-inspector-list material-list">
            {clips.map((clip, index) => (
              <li className="material-item" key={`${clip.name}:${index}`}>
                <button
                  className={`animation-inspector-row material-row${
                    index === activeIndex ? " is-selected" : ""
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  type="button"
                >
                  <span className="animation-inspector-info material-info">
                    <span className="material-name" title={clip.name}>
                      {clip.name}
                    </span>
                    <span className="material-meta" title={clip.name}>
                      {fmtSeconds(clip.duration)} · {fmtNumber(clip.trackCount)}{" "}
                      tracks · Estimated FPS {fmtFps(clip.estimatedFrameRate)} ·{" "}
                      {fmtNumber(clip.keyframeCount)} keys
                    </span>
                  </span>
                  <span className="animation-inspector-count material-count-pill">
                    {fmtNumber(clip.keyframeCount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selectedClip ? (
            <AnimationClipDetailPanel clip={selectedClip} />
          ) : null}
        </>
      ) : (
        <SidebarEmpty>No animation clip metadata found.</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
