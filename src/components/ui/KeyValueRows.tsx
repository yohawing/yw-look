import type { ReactNode } from "react";

export type KeyValueTone = "default" | "muted" | "ok" | "warn" | "danger";
export type KeyValueDensity = "compact" | "regular";

export type KeyValueRow = {
  id: string;
  label: ReactNode;
  value: ReactNode;
  tone?: KeyValueTone;
  mono?: boolean;
};

export type KeyValueRowsProps = {
  rows: readonly KeyValueRow[];
  className?: string;
  density?: KeyValueDensity;
};

export function KeyValueRows({
  rows,
  className,
  density = "compact",
}: KeyValueRowsProps) {
  const classes = [
    "yl-kv",
    density === "regular" ? "yl-kv--regular" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {rows.map((row) => (
        <div className="yl-kv-row" key={row.id}>
          <span className="yl-kv-key">{row.label}</span>
          <span
            className={[
              "yl-kv-value",
              row.mono ? "is-mono" : null,
              row.tone ? `is-${row.tone}` : null,
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
