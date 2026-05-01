import { useEffect, useState } from "react";
import type { LoadingStageId, LoadingStageSnapshot } from "../viewer";
import "../styles/viewport.css";

type LoadingScreenProps = {
  fileName?: string | null;
  stage?: LoadingStageSnapshot | null;
};

const consoleRows: Array<{ id: LoadingStageId; text: string }> = [
  { id: "scan", text: "opening file stream" },
  { id: "resolve", text: "resolving references and sidecars" },
  { id: "decode", text: "parsing asset data" },
  { id: "gpu", text: "preparing GPU resources" },
  { id: "scene", text: "mounting preview scene" },
  { id: "ui", text: "syncing inspector panels" },
];

function formatElapsed(ms: number) {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function LoadingScreen({ fileName, stage }: LoadingScreenProps) {
  const displayName = fileName ?? "Asset preview";
  const [now, setNow] = useState(() => performance.now());
  const activeStage = stage?.activeStage ?? "scan";
  const activeElapsed = stage ? now - stage.activeStageStartedAt : 0;
  const totalElapsed = stage ? stage.totalElapsedMs + activeElapsed : 0;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(performance.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="loader-root" role="status" aria-live="polite">
      <section className="loader-console" aria-label="Loading asset">
        <div className="loader-console-topbar" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="loader-console-head">
          <span className="loader-console-label">Console</span>
          <strong className="loader-console-file" title={displayName}>
            {displayName}
          </strong>
        </div>
        <ol className="loader-console-lines">
          {consoleRows.map((row) => {
            const elapsed = stage?.elapsedByStage[row.id];

            return (
              <li className={getRowClassName(row.id, stage)} key={row.id}>
                <span className="loader-console-prompt">{row.id}</span>
                <span className="loader-console-text">{row.text}</span>
                <span className="loader-console-time">
                  {row.id === activeStage
                    ? formatElapsed(activeElapsed)
                    : elapsed !== undefined
                      ? formatElapsed(elapsed)
                      : ""}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="loader-console-progress" aria-hidden="true">
          <span />
        </div>
        <div className="loader-console-caret">
          <span>await preview.ready</span>
          <b>{formatElapsed(totalElapsed)}</b>
          <i aria-hidden="true" />
        </div>
      </section>
    </div>
  );
}

function getRowClassName(
  id: LoadingStageId,
  stage: LoadingStageSnapshot | null | undefined,
) {
  if (stage?.activeStage === id) {
    return "loader-console-line is-active";
  }

  if (stage?.elapsedByStage[id] !== undefined) {
    return "loader-console-line is-done";
  }

  return "loader-console-line is-pending";
}
