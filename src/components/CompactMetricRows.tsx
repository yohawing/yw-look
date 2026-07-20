import { KeyValueRows, type KeyValueRow, type KeyValueTone } from "./ui";
import type { CompactMetricRow, CompactMetricStatus } from "../types/ui";

export type { CompactMetricStatus, CompactMetricRow } from "../types/ui";

type CompactMetricRowsProps = {
  rows: readonly CompactMetricRow[];
  className?: string;
};

const statusToTone: Record<CompactMetricStatus, KeyValueTone> = {
  neutral: "default",
  good: "ok",
  warning: "warn",
  danger: "danger",
};

export function CompactMetricRows({ rows, className }: CompactMetricRowsProps) {
  const metricRows: KeyValueRow[] = rows.map((row, index) => ({
    id: `${String(row.label)}-${index}`,
    label: row.label,
    value: row.value,
    tone: row.status ? statusToTone[row.status] : undefined,
    mono: row.mono,
  }));

  return (
    <KeyValueRows className={className} density="metric" rows={metricRows} />
  );
}
