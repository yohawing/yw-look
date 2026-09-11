import { useSidebarLayout } from "../../hooks/useSidebarLayout";
import type { SidebarLayoutId } from "../../stores/uiStore";
import type { ReactNode } from "react";
import {
  SidebarListSection,
  type SidebarListSearch,
} from "./SidebarListSection";
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
  search?: SidebarListSearch;
};

export type SidebarSplitPanelProps = {
  layoutId: SidebarLayoutId;
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
      defaultSize={`${pane.defaultSize}%`}
      id={pane.id}
      minSize={`${pane.minSize}%`}
    >
      <SidebarListSection
        className="yl-sidebar-split__section"
        title={pane.title}
        count={pane.count}
        search={pane.search}
        bodyClassName={bodyClassName}
      >
        {pane.children}
      </SidebarListSection>
    </Panel>
  );
}

export function SidebarSplitPanel({
  layoutId,
  className,
  handleClassName,
  primary,
  resizeLabel,
  secondary,
}: SidebarSplitPanelProps) {
  const layoutProps = useSidebarLayout(layoutId);
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
    <PanelGroup
      className={groupClassName}
      orientation="vertical"
      {...layoutProps}
    >
      <SplitPane pane={primary} />
      <PanelResizeHandle
        aria-label={resizeLabel}
        className={resizeHandleClassName}
      />
      <SplitPane pane={secondary} />
    </PanelGroup>
  );
}
