import { useMemo } from "react";
import type {
  ProcessMemoryMetrics,
  ResourceDiagnosticsSnapshot,
} from "../lib/diagnostics";
import { formatBytes } from "../lib/format";
import { CompactMetricRows, type CompactMetricRow } from "./CompactMetricRows";
import { SidebarEmpty, SidebarSection } from "../lib/sidebarPrimitives";

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

  return <ResourceDiagnosticsSection rows={resourceRows} />;
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
