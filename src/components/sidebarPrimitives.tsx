import type { ReactNode } from "react";
import { Disclosure } from "./ui/Disclosure";
import { KeyValueRows } from "./ui/KeyValueRows";
import type { SidebarKeyValueRow } from "../types/ui";
import "../styles/sidebar.css";

export type { SidebarKeyValueRow } from "../types/ui";

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
  if (collapsible) {
    return (
      <Disclosure
        variant="section"
        title={title}
        count={count}
        defaultOpen={defaultOpen}
      >
        {children}
      </Disclosure>
    );
  }

  return (
    <Disclosure variant="section" title={title} count={count} defaultOpen>
      {children}
    </Disclosure>
  );
}

export function SidebarKeyValueRows({
  rows,
}: {
  rows: readonly SidebarKeyValueRow[];
}) {
  return <KeyValueRows rows={rows} />;
}

export function SidebarMultilineValue({ children }: { children: ReactNode }) {
  return <span className="sidebar-multiline-value">{children}</span>;
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
