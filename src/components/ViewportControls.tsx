import { Fragment, type ReactNode } from "react";

import { ViewportToolSvg } from "./ViewportToolIcons";
import type { ToolbarAction, ToolbarItem } from "./toolbar/types";
import { PopoverTool } from "./toolbar/PopoverTool";

import "../styles/viewport.css";
import "../styles/toolbar-popover.css";

export type ViewportControlsProps = {
  isOpen?: boolean;
  onToggleOpen?: () => void;
  items: ToolbarItem[];
};

function ViewportTool({
  active = false,
  iconId,
  kind = "toggle",
  label,
  onClick,
  title,
}: {
  active?: boolean;
  iconId?: ToolbarAction["iconId"];
  kind?: ToolbarAction["kind"];
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={kind === "toggle" ? active : undefined}
      className={`viewport-tool${active ? " is-active" : ""}`}
      data-tooltip={title ?? label}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      {iconId ? <ViewportToolSvg icon={iconId} /> : null}
    </button>
  );
}

function Separator() {
  return <span className="viewport-tool-separator" aria-hidden="true" />;
}

function ViewportToolGroup({ children }: { children: ReactNode }) {
  return <div className="viewport-tool-group">{children}</div>;
}

function isSeparator(item: ToolbarItem): item is { kind: "separator" } {
  return item.kind === "separator";
}

function hasPopover(action: ToolbarAction): boolean {
  return action.children !== undefined && action.children.length > 0;
}

export function ViewportControls({
  isOpen = true,
  onToggleOpen,
  items,
}: ViewportControlsProps) {
  if (!isOpen) {
    return (
      <aside className="viewport-controls is-closed" aria-label="Viewport HUD">
        <button
          aria-label="Open viewport tools"
          className="viewport-tool"
          data-tooltip="Viewport tools"
          onClick={onToggleOpen}
          title="Viewport tools"
          type="button"
        >
          <ViewportToolSvg icon="palette" />
        </button>
      </aside>
    );
  }

  const groups: ToolbarAction[][] = [];
  let currentGroup: ToolbarAction[] = [];

  for (const item of items) {
    if (isSeparator(item)) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    } else {
      currentGroup.push(item);
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return (
    <aside className="viewport-controls" aria-label="Viewport HUD">
      {groups.map((group, groupIndex) => (
        <Fragment key={group[0]?.id ?? groupIndex}>
          {groupIndex > 0 ? <Separator /> : null}
          <ViewportToolGroup>
            {group.map((action) =>
              hasPopover(action) ? (
                <PopoverTool key={action.id} action={action} />
              ) : (
                <ViewportTool
                  key={action.id}
                  active={action.active}
                  iconId={action.iconId}
                  kind={action.kind}
                  label={action.label}
                  onClick={action.onRun ?? (() => {})}
                  title={action.description}
                />
              ),
            )}
          </ViewportToolGroup>
        </Fragment>
      ))}
    </aside>
  );
}
