import type { ReactNode } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";

export type SidebarSplitPane = {
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  count?: ReactNode;
  defaultSize: number;
  id: string;
  minSize: number;
  title: ReactNode;
};

export type SidebarSplitPanelProps = {
  className?: string;
  handleClassName?: string;
  primary: SidebarSplitPane;
  resizeLabel: string;
  secondary: SidebarSplitPane;
};

function SplitPane({ pane }: { pane: SidebarSplitPane }) {
  const panelClassName = ["yl-sidebar-split__pane", pane.className]
    .filter(Boolean)
    .join(" ");
  const bodyClassName = [
    "yl-disclosure__body",
    "yl-sidebar-split__body",
    pane.bodyClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Panel
      className={panelClassName}
      defaultSize={pane.defaultSize}
      id={pane.id}
      minSize={pane.minSize}
    >
      <section className="yl-sidebar-split__section yl-disclosure yl-disclosure--section">
        <div className="yl-disclosure__summary">
          <ChevronDownIcon
            className="yl-disclosure__chevron"
            aria-hidden="true"
          />
          <span className="yl-disclosure__title">{pane.title}</span>
          {pane.count != null ? (
            <span className="yl-disclosure__count">{pane.count}</span>
          ) : null}
        </div>
        <div className={bodyClassName}>{pane.children}</div>
      </section>
    </Panel>
  );
}

export function SidebarSplitPanel({
  className,
  handleClassName,
  primary,
  resizeLabel,
  secondary,
}: SidebarSplitPanelProps) {
  const groupClassName = ["yl-sidebar-split", className]
    .filter(Boolean)
    .join(" ");
  const resizeHandleClassName = [
    "yl-sidebar-split__resize-handle",
    handleClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <PanelGroup className={groupClassName} orientation="vertical">
      <SplitPane pane={primary} />
      <PanelResizeHandle
        aria-label={resizeLabel}
        className={resizeHandleClassName}
      />
      <SplitPane pane={secondary} />
    </PanelGroup>
  );
}
