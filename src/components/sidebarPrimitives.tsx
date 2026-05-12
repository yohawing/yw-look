import { useState, type ReactNode } from "react";

export type SidebarKeyValueRow = {
  id: string;
  label: ReactNode;
  value: ReactNode;
  tone?: "default" | "muted" | "ok" | "warn" | "danger";
  mono?: boolean;
};

export function SidebarSection({
  children,
  collapsible = false,
  count,
  defaultOpen = true,
  title,
}: {
  children: ReactNode;
  collapsible?: boolean;
  count?: ReactNode;
  defaultOpen?: boolean;
  title: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (collapsible) {
    return (
      <details
        className="sidebar-section is-collapsible"
        onToggle={(event) => setOpen(event.currentTarget.open)}
        open={open}
      >
        <summary className="sidebar-section-head">
          <span className="sidebar-section-chevron" aria-hidden="true">
            ▾
          </span>
          <span className="sidebar-section-title card-title">{title}</span>
          {count ? (
            <span className="sidebar-section-count">{count}</span>
          ) : null}
        </summary>
        <div className="sidebar-section-body">{children}</div>
      </details>
    );
  }

  return (
    <section className="sidebar-section">
      <header className="sidebar-section-head">
        <span className="sidebar-section-chevron" aria-hidden="true">
          ▾
        </span>
        <span className="sidebar-section-title card-title">{title}</span>
        {count ? <span className="sidebar-section-count">{count}</span> : null}
      </header>
      <div className="sidebar-section-body">{children}</div>
    </section>
  );
}

export function SidebarKeyValueRows({
  rows,
}: {
  rows: readonly SidebarKeyValueRow[];
}) {
  return (
    <div className="sidebar-kv">
      {rows.map((row) => (
        <div className="sidebar-kv-row" key={row.id}>
          <span className="sidebar-kv-key">{row.label}</span>
          <span
            className={[
              "sidebar-kv-value",
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

export function SidebarEmpty({ children }: { children: ReactNode }) {
  return <p className="sidebar-empty">{children}</p>;
}

function formatSidebarError(message: string): string {
  if (
    message.includes("reading 'invoke'") ||
    message.includes("not available") ||
    message.includes("__TAURI__")
  ) {
    return "Native API unavailable in browser preview.";
  }

  return message;
}

export function SidebarError({ children }: { children: ReactNode }) {
  return (
    <p className="card-error">
      {typeof children === "string" ? formatSidebarError(children) : children}
    </p>
  );
}
