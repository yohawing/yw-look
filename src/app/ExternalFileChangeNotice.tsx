import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, useLocale } from "../lib/i18n";
import { errorMessage } from "../lib/errors";
import { resolveSelectedFile } from "../lib/files";
import { useViewerStore } from "../stores/viewerStore";
import { useFileStore } from "../stores/fileStore";
import { evictAll } from "../viewer/prefetchCache";

type Change = {
  watchId: string;
  revision: number;
  kind: "modified" | "replaced" | "renamed" | "deleted" | "error";
  detail: string | null;
};

export function ExternalFileChangeNotice({ enabled }: { enabled: boolean }) {
  useLocale();
  const file = useFileStore((s) => s.currentFile);
  const reload = useFileStore((s) => s.externalReload);
  const [change, setChange] = useState<Change | null>(null);
  const [watchAttempt, setWatchAttempt] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const generation = useRef(0);
  const [consumed, setConsumed] = useState<{
    change: Change | null;
    revision: number;
  } | null>(null);
  const path = file?.path;

  useEffect(() => {
    const current = ++generation.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- invalidate notices when the watched file changes
    setChange(null);
    setResolveError(null);
    setResolving(false);
    if (!enabled || !path || path.startsWith("browser-local://")) return;
    const watchId = crypto.randomUUID();
    let stopped = false;
    let lastRevision = -1;
    let unlisten: (() => void) | undefined;
    const start = async () => {
      unlisten = await listen<Change>(
        "yw-look://file-changed",
        ({ payload }) => {
          if (
            !stopped &&
            payload.watchId === watchId &&
            payload.revision > lastRevision
          ) {
            lastRevision = payload.revision;
            setChange((prior) =>
              !prior || payload.revision > prior.revision ? payload : prior,
            );
            setResolveError(null);
          }
        },
      );
      if (!stopped) await invoke("start_file_watch", { path, watchId });
      if (stopped) {
        unlisten();
        await invoke("stop_file_watch", { watchId });
      }
    };
    void start().catch((error: unknown) => {
      if (!stopped && generation.current === current)
        setChange({
          watchId,
          revision: 0,
          kind: "error",
          detail: errorMessage(error, "File watch failed"),
        });
    });
    return () => {
      stopped = true;
      unlisten?.();
      void invoke("stop_file_watch", { watchId }).catch(() => {});
    };
  }, [enabled, path, watchAttempt]);

  useEffect(() => {
    if (reload?.status === "done" && reload.revision === consumed?.revision) {
      const viewer = useViewerStore.getState();
      viewer.setSelectedUsdPrimPath(null);
      viewer.clearMaterialNavigationRequest();
      viewer.clearTextureNavigationRequest();
      // A second save during a reload must remain visible.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- acknowledge the successfully loaded save revision
      setChange((value) => (value === consumed?.change ? null : value));
    }
  }, [reload, consumed]);

  const reloadFile = async () => {
    if (!file || resolving || reload?.status === "loading") return;
    const current = generation.current;
    setResolving(true);
    setResolveError(null);
    try {
      const resolved = await resolveSelectedFile(file.path);
      if (current !== generation.current) return;
      evictAll();
      useFileStore.getState().requestExternalReload(resolved);
      setConsumed({
        change,
        revision: useFileStore.getState().externalReload!.revision,
      });
    } catch (error) {
      if (current === generation.current)
        setResolveError(errorMessage(error, "Reload failed"));
    } finally {
      if (current === generation.current) setResolving(false);
    }
  };

  if (!change) return null;
  const busy =
    resolving ||
    (!!reload && reload.path === path && reload.status === "loading");
  const failure =
    resolveError ??
    (reload &&
    reload.path === path &&
    reload.status === "failed" &&
    change === consumed?.change
      ? reload.error
      : null);
  return (
    <section className="crash-recovery-notice" role="status" aria-live="polite">
      <div>
        <h2>{t(`externalFile.${change.kind}`)}</h2>
        <p>
          {file?.fileName} — {t("externalFile.kept")}
        </p>
        {(failure || change.detail) && <p>{failure || change.detail}</p>}
      </div>
      <div className="crash-recovery-notice__actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            change.kind === "error" && !failure
              ? setWatchAttempt((n) => n + 1)
              : void reloadFile()
          }
        >
          {t(
            busy
              ? "externalFile.loading"
              : change.kind === "error" && !failure
                ? "externalFile.retryWatch"
                : "externalFile.reload",
          )}
        </button>
        <button type="button" disabled={busy} onClick={() => setChange(null)}>
          {t("externalFile.later")}
        </button>
      </div>
    </section>
  );
}
