import { SidebarKeyValueRows, SidebarSection } from "./sidebarPrimitives";
import type { PerformanceSnapshot } from "../types/ui";

export type { PerformanceSnapshot } from "../types/ui";

type PerformanceCardProps = {
  snapshot: PerformanceSnapshot;
};

function formatMetric(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}

export function PerformanceCard({ snapshot }: PerformanceCardProps) {
  return (
    <SidebarSection title="Performance" collapsible defaultOpen={false}>
      <SidebarKeyValueRows
        rows={[
          {
            id: "startup",
            label: "Startup",
            value: formatMetric(snapshot.startupMs),
            mono: true,
          },
          {
            id: "first-paint",
            label: "First Paint",
            value: formatMetric(snapshot.firstPaintMs),
            mono: true,
          },
          {
            id: "interactive",
            label: "Interactive",
            value: formatMetric(snapshot.interactiveMs),
            mono: true,
          },
          {
            id: "latest-load",
            label: "Latest load",
            value: formatMetric(snapshot.loadMs),
            mono: true,
            tone: snapshot.loadMs === null ? "muted" : "default",
          },
          {
            id: "navigation",
            label: "Navigation",
            value: formatMetric(snapshot.navigationMs),
            mono: true,
            tone: snapshot.navigationMs === null ? "muted" : "default",
          },
        ]}
      />
    </SidebarSection>
  );
}
