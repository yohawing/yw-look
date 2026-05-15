import { useEffect, useState } from "react";
import {
  buildReport,
  finishBenchRun,
  loadBenchConfig,
  loadBenchManifest,
  runBenchCase,
  writeBenchReport,
  writeBenchStatus,
} from "./benchRuntime";

type BenchStatus = {
  state: "starting" | "running" | "done" | "failed";
  message: string;
  completed: number;
  total: number;
};

export function BenchRunner() {
  const [status, setStatus] = useState<BenchStatus>({
    state: "starting",
    message: "Starting load bench",
    completed: 0,
    total: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const publishStatus = async (nextStatus: BenchStatus) => {
      setStatus(nextStatus);
      try {
        await writeBenchStatus({
          ...nextStatus,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // Keep the benchmark running even if status diagnostics fail.
      }
    };

    const run = async () => {
      try {
        const config = await loadBenchConfig();
        if (!config?.enabled) {
          throw new Error("bench mode is not enabled");
        }

        const manifest = await loadBenchManifest(config.modelsPath);
        const models =
          config.caseIds.length === 0
            ? manifest.models
            : manifest.models.filter((model) =>
                config.caseIds.includes(model.id),
              );
        const missingIds = config.caseIds.filter(
          (id) => !manifest.models.some((model) => model.id === id),
        );
        if (missingIds.length > 0) {
          throw new Error(`bench case not found: ${missingIds.join(", ")}`);
        }
        const results = [];

        for (const model of models) {
          if (cancelled) {
            return;
          }
          await publishStatus({
            state: "running",
            message: `Running ${model.id}`,
            completed: results.length,
            total: models.length,
          });
          results.push(
            await runBenchCase(model, (message) => {
              void publishStatus({
                state: "running",
                message,
                completed: results.length,
                total: models.length,
              });
            }),
          );
        }

        const report = buildReport(config, results);
        await writeBenchReport(report);
        await publishStatus({
          state: report.summary.failed > 0 ? "failed" : "done",
          message: `Completed with ${report.summary.failed} failed case(s)`,
          completed: results.length,
          total: models.length,
        });
        await finishBenchRun(report.summary.failed > 0 ? 1 : 0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await publishStatus({
          state: "failed",
          message,
          completed: 0,
          total: 0,
        });
        await finishBenchRun(1);
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
          width: 420,
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>yw-look load bench</h1>
        <p style={{ color: "#aab4c0", margin: "0 0 16px" }}>{status.message}</p>
        <progress
          max={Math.max(status.total, 1)}
          value={status.completed}
          style={{ width: "100%" }}
        />
        <p style={{ color: "#7f8b99", fontSize: 12, margin: "12px 0 0" }}>
          {status.state} · {status.completed}/{status.total}
        </p>
      </section>
    </main>
  );
}
