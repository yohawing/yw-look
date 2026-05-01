import { useEffect, useState } from "react";
import {
  finishShotRun,
  loadShotConfig,
  runShot,
  type ShotConfig,
  type ShotOutcome,
} from "./shotRuntime";

type ShotState = {
  state: "starting" | "running" | "done" | "failed";
  message: string;
  config: ShotConfig | null;
  outcome: ShotOutcome | null;
};

export function ShotRunner() {
  const [status, setStatus] = useState<ShotState>({
    state: "starting",
    message: "Loading shot configuration",
    config: null,
    outcome: null,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const config = await loadShotConfig();
        if (!config) {
          throw new Error("shot mode is not enabled");
        }
        if (cancelled) {
          return;
        }
        setStatus({
          state: "running",
          message: `Rendering ${config.fileName}`,
          config,
          outcome: null,
        });

        const outcome = await runShot(config);
        if (cancelled) {
          return;
        }

        const failed =
          outcome.error !== null ||
          !outcome.loaded ||
          (config.mode === "shot" && !outcome.nonBlankCanvas);

        setStatus({
          state: failed ? "failed" : "done",
          message:
            outcome.error ??
            (config.mode === "shot"
              ? `Wrote ${outcome.outputPath}`
              : `Loaded ${outcome.meshCount} mesh(es) in ${outcome.loadTimeMs}ms`),
          config,
          outcome,
        });
        await finishShotRun(failed ? 1 : 0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({
          state: "failed",
          message,
          config: null,
          outcome: null,
        });
        await finishShotRun(1);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        alignItems: "center",
        background: "#111318",
        color: "#eef2f7",
        display: "flex",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        height: "100vh",
        justifyContent: "center",
      }}
    >
      <section
        style={{
          border: "1px solid #2c3440",
          borderRadius: 8,
          padding: 24,
          width: 480,
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>
          yw-look {status.config?.mode ?? "shot"}
        </h1>
        <p style={{ color: "#aab4c0", margin: "0 0 16px" }}>{status.message}</p>
        {status.config ? (
          <p style={{ color: "#7f8b99", fontSize: 12, margin: 0 }}>
            {status.config.inputPath} · {status.config.width}×
            {status.config.height}
          </p>
        ) : null}
        <p style={{ color: "#7f8b99", fontSize: 12, margin: "12px 0 0" }}>
          {status.state}
        </p>
      </section>
    </main>
  );
}
