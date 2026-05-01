import type { ReactNode } from "react";
import "../styles/sidebar.css";

export type CompactMetricStatus = "neutral" | "good" | "warning" | "danger";

export type CompactMetricRow = {
  label: ReactNode;
  value: ReactNode;
  status?: CompactMetricStatus;
  mono?: boolean;
};

type CompactMetricRowsProps = {
  rows: readonly CompactMetricRow[];
  className?: string;
};

export function CompactMetricRows({ rows, className }: CompactMetricRowsProps) {
  return (
    <div
      className={["compact-metric-rows", "card-rows", className]
        .filter(Boolean)
        .join(" ")}
    >
      {rows.map((row, index) => (
        <div
          className={[
            "compact-metric-row",
            "card-row",
            row.status ? `is-${row.status}` : null,
          ]
            .filter(Boolean)
            .join(" ")}
          key={`${String(row.label)}-${index}`}
        >
          <span className="compact-metric-label card-row-label">
            {row.label}
          </span>
          <span
            className={[
              "compact-metric-value",
              row.mono ? "card-row-value-mono" : "card-row-value",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
