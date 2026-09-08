import type { ReactNode } from "react";
import { Disclosure } from "../components/ui/Disclosure";
import { KeyValueRows } from "../components/ui/KeyValueRows";
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

type AsyncSidebarSectionProps<T> = {
  children: (data: T) => ReactNode;
  collapsible?: boolean;
  count?: ReactNode | ((data: T) => ReactNode);
  data: T | null | undefined;
  defaultOpen?: boolean;
  error?: ReactNode | null;
  loadingLabel: ReactNode;
  title: ReactNode;
};

export function AsyncSidebarSection<T>({
  children,
  collapsible,
  count,
  data,
  defaultOpen,
  error = null,
  loadingLabel,
  title,
}: AsyncSidebarSectionProps<T>) {
  let resolvedCount: ReactNode;
  if (typeof count === "function") {
    resolvedCount = data == null ? undefined : count(data);
  } else {
    resolvedCount = count;
  }

  return (
    <SidebarSection
      collapsible={collapsible}
      count={resolvedCount}
      defaultOpen={defaultOpen}
      title={title}
    >
      {error ? (
        <SidebarError>{error}</SidebarError>
      ) : data == null ? (
        <SidebarEmpty>{loadingLabel}</SidebarEmpty>
      ) : (
        children(data)
      )}
    </SidebarSection>
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

export { Button } from "../components/ui/Button";
export { SelectField } from "../components/ui/SelectField";
export { ListTextFilter } from "../components/ui/ListTextFilter";
export { SelectableListItem } from "../components/ui/SelectableListItem";
export { Disclosure } from "../components/ui/Disclosure";
