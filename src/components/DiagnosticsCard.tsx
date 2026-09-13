import { t, useLocale, formatNumber } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import type {
  DiagnosticsPayload,
  ProcessMemoryMetrics,
  ResourceDiagnosticsSnapshot,
} from "../lib/diagnostics";
import { loadDiagnosticsSnapshot, openAppLogDir } from "../lib/diagnostics";
import { formatBytes } from "../lib/format";
import { buildDiagnosticsReport, ISSUE_REPORT_URL } from "../lib/reporting";
import { backendCapabilities } from "../lib/usd";
import { CompactMetricRows, type CompactMetricRow } from "./CompactMetricRows";
import { SidebarEmpty, SidebarSection } from "../lib/sidebarPrimitives";
import { Button } from "./ui/Button";

type DiagnosticsCardProps = {
  processMemoryMetrics: ProcessMemoryMetrics | null;
  resourceDiagnostics: ResourceDiagnosticsSnapshot | null;
};

export function DiagnosticsCard({
  processMemoryMetrics,
  resourceDiagnostics,
}: DiagnosticsCardProps) {
  const locale = useLocale();
  const resourceRows = useMemo(
    () => buildResourceRows(resourceDiagnostics, processMemoryMetrics),
    [locale, processMemoryMetrics, resourceDiagnostics],
  );

  return (
    <>
      <OperationalDiagnosticsSection />
      <ResourceDiagnosticsSection rows={resourceRows} />
    </>
  );
}

function OperationalDiagnosticsSection() {
  const locale = useLocale();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(
    null,
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const refreshDiagnostics = async () => {
    setDiagnostics(await loadDiagnosticsSnapshot());
  };

  useEffect(() => {
    let active = true;
    void loadDiagnosticsSnapshot().then((snapshot) => {
      if (active) {
        setDiagnostics(snapshot);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const rows = useMemo<CompactMetricRow[]>(() => {
    if (!diagnostics) {
      return [];
    }
    return [
      {
        label: t("app_logs"),
        value: diagnostics.appLogDir || "unavailable",
        mono: true,
      },
      {
        label: t("diagnostics_log"),
        value: diagnostics.diagnosticsLogPath || "unavailable",
        mono: true,
      },
      {
        label: t("recent_records"),
        value: formatNumber(diagnostics.diagnosticsSnapshot.length),
        mono: true,
      },
    ];
  }, [locale, diagnostics]);

  const copyDiagnostics = async () => {
    const snapshot = await loadDiagnosticsSnapshot();
    setDiagnostics(snapshot);
    const capabilities = await backendCapabilities().catch(() => null);
    const report = buildDiagnosticsReport({
      capabilities,
      diagnostics: snapshot,
    });
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <SidebarSection title={t("log_details")} collapsible>
      {rows.length > 0 ? (
        <CompactMetricRows rows={rows} />
      ) : (
        <SidebarEmpty>{t("no_diagnostics_snapshot_loaded")}</SidebarEmpty>
      )}
      {diagnostics && diagnostics.diagnosticsSnapshot.length > 0 ? (
        <ul
          className="diagnostics-log-list"
          aria-label={t("recent_diagnostics")}
        >
          {diagnostics.diagnosticsSnapshot.slice(-8).map((line, index) => (
            <li key={`${line}:${index}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="card-actions">
        <Button onClick={() => void openAppLogDir()} size="sm" variant="ghost">
          {t("open_logs")}
        </Button>
        <Button
          onClick={() => void copyDiagnostics()}
          size="sm"
          variant="ghost"
        >
          {copyState === "copied"
            ? t("copied")
            : copyState === "failed"
              ? t("copy.failure")
              : "Copy Diagnostics"}
        </Button>
        <Button
          onClick={() => window.open(ISSUE_REPORT_URL, "_blank", "noopener")}
          size="sm"
          variant="ghost"
        >
          {t("report_issue")}
        </Button>
        <Button
          onClick={() => void refreshDiagnostics()}
          size="sm"
          variant="subtle"
        >
          {t("refresh")}
        </Button>
      </div>
    </SidebarSection>
  );
}

function ResourceDiagnosticsSection({
  rows,
}: {
  rows: readonly CompactMetricRow[];
}) {
  useLocale();
  return (
    <SidebarSection
      title={t("resources")}
      count={rows.length > 0 ? rows.length : undefined}
      collapsible
      defaultOpen={false}
    >
      {rows.length > 0 ? (
        <CompactMetricRows rows={rows} />
      ) : (
        <SidebarEmpty>{t("no_runtime_resource_metrics_yet")}</SidebarEmpty>
      )}
    </SidebarSection>
  );
}

function buildResourceRows(
  snapshot: ResourceDiagnosticsSnapshot | null,
  processMemory: ProcessMemoryMetrics | null,
): CompactMetricRow[] {
  const rows: CompactMetricRow[] = [];

  if (processMemory) {
    rows.push(
      {
        label: t("process_memory"),
        value: formatBytes(processMemory.residentSetBytes),
        mono: true,
      },
      {
        label: t("virtual_memory"),
        value: formatBytes(processMemory.virtualMemoryBytes),
        mono: true,
      },
    );
  }

  if (snapshot) {
    rows.push(
      {
        label: t("webgl_geometry"),
        value: formatCount(snapshot.webgl.geometries),
        mono: true,
      },
      {
        label: t("webgl_textures"),
        value: formatCount(snapshot.webgl.textures),
        mono: true,
      },
      {
        label: t("webgl_programs"),
        value:
          snapshot.webgl.programs === null
            ? "unavailable"
            : formatCount(snapshot.webgl.programs),
        mono: true,
      },
      {
        label: t("draw_calls"),
        value: formatCount(snapshot.webgl.calls),
        mono: true,
      },
      {
        label: t("frame_triangles"),
        value: formatCount(snapshot.webgl.triangles),
        mono: true,
      },
      {
        label: t("frame_points_lines"),
        value: `${formatCount(snapshot.webgl.points)} / ${formatCount(snapshot.webgl.lines)}`,
        mono: true,
      },
    );

    if (snapshot.asset) {
      rows.push(
        {
          label: t("asset_vertices"),
          value: formatCount(snapshot.asset.vertices),
          mono: true,
        },
        {
          label: t("asset_triangles"),
          value: formatCount(snapshot.asset.triangles),
          mono: true,
        },
        {
          label: t("asset_materials_textures"),
          value: `${formatCount(snapshot.asset.materials)} / ${formatCount(snapshot.asset.textures)}`,
          mono: true,
        },
      );
    }

    if (snapshot.memory.jsHeapUsedBytes !== null) {
      rows.push({
        label: t("js_heap_used"),
        value: formatBytes(snapshot.memory.jsHeapUsedBytes),
        mono: true,
      });
    }

    if (snapshot.memory.jsHeapTotalBytes !== null) {
      rows.push({
        label: t("js_heap_total"),
        value: formatBytes(snapshot.memory.jsHeapTotalBytes),
        mono: true,
      });
    }

    if (snapshot.memory.jsHeapLimitBytes !== null) {
      rows.push({
        label: t("js_heap_limit"),
        value: formatBytes(snapshot.memory.jsHeapLimitBytes),
        mono: true,
      });
    }
  }

  return rows;
}

function formatCount(value: number) {
  return Number.isFinite(value) ? formatNumber(value) : "0";
}
