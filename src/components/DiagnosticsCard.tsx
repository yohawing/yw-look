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
  const resourceRows = useMemo(
    () => buildResourceRows(resourceDiagnostics, processMemoryMetrics),
    [processMemoryMetrics, resourceDiagnostics],
  );

  return (
    <>
      <OperationalDiagnosticsSection />
      <ResourceDiagnosticsSection rows={resourceRows} />
    </>
  );
}

function OperationalDiagnosticsSection() {
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
        label: "App logs",
        value: diagnostics.appLogDir || "unavailable",
        mono: true,
      },
      {
        label: "Diagnostics log",
        value: diagnostics.diagnosticsLogPath || "unavailable",
        mono: true,
      },
      {
        label: "Recent records",
        value: diagnostics.diagnosticsSnapshot.length.toLocaleString(),
        mono: true,
      },
    ];
  }, [diagnostics]);

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
    <SidebarSection title="Log Details" collapsible>
      {rows.length > 0 ? (
        <CompactMetricRows rows={rows} />
      ) : (
        <SidebarEmpty>No diagnostics snapshot loaded.</SidebarEmpty>
      )}
      {diagnostics && diagnostics.diagnosticsSnapshot.length > 0 ? (
        <ul className="diagnostics-log-list" aria-label="Recent diagnostics">
          {diagnostics.diagnosticsSnapshot.slice(-8).map((line, index) => (
            <li key={`${line}:${index}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="card-actions">
        <Button onClick={() => void openAppLogDir()} size="sm" variant="ghost">
          Open Logs
        </Button>
        <Button
          onClick={() => void copyDiagnostics()}
          size="sm"
          variant="ghost"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy Failed"
              : "Copy Diagnostics"}
        </Button>
        <Button
          onClick={() => window.open(ISSUE_REPORT_URL, "_blank", "noopener")}
          size="sm"
          variant="ghost"
        >
          Report Issue
        </Button>
        <Button
          onClick={() => void refreshDiagnostics()}
          size="sm"
          variant="subtle"
        >
          Refresh
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
  return (
    <SidebarSection
      title="Resources"
      count={rows.length > 0 ? rows.length : undefined}
      collapsible
      defaultOpen={false}
    >
      {rows.length > 0 ? (
        <CompactMetricRows rows={rows} />
      ) : (
        <SidebarEmpty>No runtime resource metrics yet.</SidebarEmpty>
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
        label: "Process memory",
        value: formatBytes(processMemory.residentSetBytes),
        mono: true,
      },
      {
        label: "Virtual memory",
        value: formatBytes(processMemory.virtualMemoryBytes),
        mono: true,
      },
    );
  }

  if (snapshot) {
    rows.push(
      {
        label: "WebGL geometry",
        value: formatCount(snapshot.webgl.geometries),
        mono: true,
      },
      {
        label: "WebGL textures",
        value: formatCount(snapshot.webgl.textures),
        mono: true,
      },
      {
        label: "WebGL programs",
        value:
          snapshot.webgl.programs === null
            ? "unavailable"
            : formatCount(snapshot.webgl.programs),
        mono: true,
      },
      {
        label: "Draw calls",
        value: formatCount(snapshot.webgl.calls),
        mono: true,
      },
      {
        label: "Frame triangles",
        value: formatCount(snapshot.webgl.triangles),
        mono: true,
      },
      {
        label: "Frame points / lines",
        value: `${formatCount(snapshot.webgl.points)} / ${formatCount(snapshot.webgl.lines)}`,
        mono: true,
      },
    );

    if (snapshot.asset) {
      rows.push(
        {
          label: "Asset vertices",
          value: formatCount(snapshot.asset.vertices),
          mono: true,
        },
        {
          label: "Asset triangles",
          value: formatCount(snapshot.asset.triangles),
          mono: true,
        },
        {
          label: "Asset materials / textures",
          value: `${formatCount(snapshot.asset.materials)} / ${formatCount(snapshot.asset.textures)}`,
          mono: true,
        },
      );
    }

    if (snapshot.memory.jsHeapUsedBytes !== null) {
      rows.push({
        label: "JS heap used",
        value: formatBytes(snapshot.memory.jsHeapUsedBytes),
        mono: true,
      });
    }

    if (snapshot.memory.jsHeapTotalBytes !== null) {
      rows.push({
        label: "JS heap total",
        value: formatBytes(snapshot.memory.jsHeapTotalBytes),
        mono: true,
      });
    }

    if (snapshot.memory.jsHeapLimitBytes !== null) {
      rows.push({
        label: "JS heap limit",
        value: formatBytes(snapshot.memory.jsHeapLimitBytes),
        mono: true,
      });
    }
  }

  return rows;
}

function formatCount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}
