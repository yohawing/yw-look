import { t, useLocale } from "../lib/i18n";
import { useEffect, useState } from "react";
import type {
  DeferredTextureSnapshot,
  LoadingStageId,
  LoadingStageSnapshot,
} from "../viewer";
import "../styles/viewport.css";

type LoadingScreenProps = {
  fileName?: string | null;
  stage?: LoadingStageSnapshot | null;
  deferredTexture?: DeferredTextureSnapshot | null;
  compact?: boolean;
};

type ConsoleRow = {
  id: LoadingStageId | "texture" | "payload";
  text: string;
  time: string;
  state: "is-active" | "is-done" | "is-pending";
};

function formatElapsed(ms: number) {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function LoadingScreen({
  compact = false,
  deferredTexture = null,
  fileName,
  stage,
}: LoadingScreenProps) {
  useLocale();
  const consoleRows: Array<{ id: LoadingStageId; text: string }> = [
    { id: "scan", text: t("opening_file") },
    { id: "resolve", text: t("finding_linked_files") },
    { id: "decode", text: t("reading_asset_data") },
    { id: "gpu", text: t("preparing_preview") },
    { id: "scene", text: t("building_scene") },
    { id: "ui", text: t("updating_panels") },
  ];

  const displayName = fileName ?? t("preview");
  const [now, setNow] = useState(() => performance.now());
  const activeStage = stage?.activeStage ?? "scan";
  const activeElapsed = stage ? now - stage.activeStageStartedAt : 0;
  const totalElapsed = stage ? stage.totalElapsedMs + activeElapsed : 0;
  const deferredTextureProgress = !stage ? deferredTexture : null;
  const deferredKind = deferredTextureProgress?.kind ?? "texture";
  const deferredLabel =
    deferredKind === "payload"
      ? {
          id: "payload" as const,
          text: t("loading_linked_scene_data"),
          idle: t("finishing_linked_data"),
        }
      : {
          id: "texture" as const,
          text: t("loading_textures"),
          idle: t("finishing_textures"),
        };
  const rows: ConsoleRow[] = deferredTextureProgress
    ? [
        ...consoleRows.map<ConsoleRow>((row) => ({
          id: row.id,
          text: row.text,
          time: "",
          state: "is-done" as const,
        })),
        {
          id: deferredLabel.id,
          text: deferredLabel.text,
          time:
            deferredTextureProgress.total > 0
              ? `${deferredTextureProgress.loaded + deferredTextureProgress.failed}/${deferredTextureProgress.total}`
              : "",
          state: deferredTextureProgress.pending > 0 ? "is-active" : "is-done",
        },
      ]
    : consoleRows.map((row) => {
        const elapsed = stage?.elapsedByStage[row.id];
        return {
          id: row.id,
          text: row.text,
          time:
            row.id === activeStage
              ? formatElapsed(activeElapsed)
              : elapsed !== undefined
                ? formatElapsed(elapsed)
                : "",
          state: getRowState(row.id, stage),
        };
      });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(performance.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={`loader-root${compact ? " is-compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <section className="loader-console" aria-label={t("loading_asset")}>
        <div className="loader-console-topbar" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="loader-console-head">
          <span className="loader-console-label">{t("loading")}</span>
          <strong className="loader-console-file" title={displayName}>
            {displayName}
          </strong>
        </div>
        <ol className="loader-console-lines">
          {rows.map((row) => (
            <li className={`loader-console-line ${row.state}`} key={row.id}>
              <span className="loader-console-prompt">{row.id}</span>
              <span className="loader-console-text">{row.text}</span>
              <span className="loader-console-time">{row.time}</span>
            </li>
          ))}
        </ol>
        <div className="loader-console-progress" aria-hidden="true">
          <span />
        </div>
        <div className="loader-console-caret">
          <span>
            {deferredTextureProgress?.activeLabel
              ? deferredTextureProgress.activeLabel
              : deferredTextureProgress
                ? deferredLabel.idle
                : t("preparing_preview")}
          </span>
          <b>
            {deferredTextureProgress
              ? t("loading.pending", { count: deferredTextureProgress.pending })
              : formatElapsed(totalElapsed)}
          </b>
          <i aria-hidden="true" />
        </div>
      </section>
    </div>
  );
}

function getRowState(
  id: LoadingStageId,
  stage: LoadingStageSnapshot | null | undefined,
) {
  if (stage?.activeStage === id) {
    return "is-active";
  }

  if (stage?.elapsedByStage[id] !== undefined) {
    return "is-done";
  }

  return "is-pending";
}
