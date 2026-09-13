import { t, useLocale } from "../lib/i18n";
import type { ReactNode } from "react";

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
  disabled = false,
  iconId,
  kind = "toggle",
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  iconId?: ToolbarAction["iconId"];
  kind?: ToolbarAction["kind"];
  label: string;
  onClick: () => void;
}) {
  useLocale();
  return (
    <button
      aria-label={label}
      aria-pressed={kind === "toggle" ? active : undefined}
      className={`viewport-tool${active ? " is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {iconId ? <ViewportToolSvg icon={iconId} /> : null}
    </button>
  );
}

function ViewportToolGroup({ children }: { children: ReactNode }) {
  useLocale();
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
  useLocale();
  if (!isOpen) {
    return (
      <aside
        className="viewport-controls is-closed"
        aria-label={t("viewport_hud")}
      >
        <button
          aria-label={t("open_viewport_tools")}
          className="viewport-tool"
          onClick={onToggleOpen}
          type="button"
        >
          <ViewportToolSvg icon="palette" />
        </button>
      </aside>
    );
  }

  const actions = items.filter(
    (item): item is ToolbarAction =>
      !isSeparator(item) && item.kind !== "status",
  );

  return (
    <aside className="viewport-controls" aria-label={t("viewport_hud")}>
      <ViewportToolGroup>
        {actions.map((action) =>
          hasPopover(action) ? (
            <PopoverTool key={action.id} action={action} />
          ) : (
            <ViewportTool
              key={action.id}
              active={action.active}
              disabled={action.disabled}
              iconId={action.iconId}
              kind={action.kind}
              label={action.label}
              onClick={action.onRun ?? (() => {})}
            />
          ),
        )}
      </ViewportToolGroup>
    </aside>
  );
}
