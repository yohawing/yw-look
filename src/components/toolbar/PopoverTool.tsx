import { useCallback, useRef, useState, type ReactNode } from "react";
import { ViewportToolSvg } from "../ViewportToolIcons";
import { PopoverContent, PopoverTrigger } from "../ui/Popover";
import type { ToolbarAction, ToolbarItem, ToolbarStatus } from "./types";
import { ToolbarPopover } from "./ToolbarPopover";

type PopoverToolProps = {
  action: ToolbarAction;
};

export function PopoverTool({ action }: PopoverToolProps) {
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const hasChildren = action.children && action.children.length > 0;

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!openTimerRef.current) {
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        setOpen(true);
      }, 300);
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!closeTimerRef.current) {
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setOpen(false);
      }, 200);
    }
  }, []);

  const handleClose = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      clearTimers();
      setOpen(nextOpen);
    },
    [clearTimers],
  );

  const handleTriggerClick = useCallback(() => {
    if (action.kind === "toggle") {
      action.onRun?.();
      if (hasChildren) {
        setOpen(true);
      }
      return;
    }
    if (hasChildren && !open) {
      setOpen(true);
      return;
    }
    if (action.onRun) {
      action.onRun();
      return;
    }
    if (open) {
      setOpen(false);
    }
  }, [action, hasChildren, open]);

  const handleChildAction = useCallback(
    (childOnRun?: () => void) => {
      if (childOnRun) {
        childOnRun();
      }
      handleClose();
    },
    [handleClose],
  );

  return (
    <ToolbarPopover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-expanded={open}
          aria-haspopup={hasChildren ? "menu" : undefined}
          aria-label={action.label}
          className={`viewport-tool${action.active ? " is-active" : ""}${open ? " is-hover" : ""}`}
          disabled={action.disabled}
          onClick={handleTriggerClick}
          onPointerEnter={scheduleOpen}
          onPointerLeave={scheduleClose}
          type="button"
        >
          {action.iconId ? <ViewportToolSvg icon={action.iconId} /> : null}
        </button>
      </PopoverTrigger>

      {hasChildren ? (
        <PopoverContent
          align="start"
          className="toolbar-popover"
          role="menu"
          side="right"
          onPointerEnter={scheduleOpen}
          onPointerLeave={scheduleClose}
        >
          <div className="toolbar-popover-header">{action.label}</div>
          <ToolbarPopoverItems
            items={action.children!}
            onAction={handleChildAction}
          />
        </PopoverContent>
      ) : null}
    </ToolbarPopover>
  );
}

function ToolbarPopoverItems({
  items,
  onAction,
}: {
  items: ToolbarItem[];
  onAction: (onRun?: () => void) => void;
}) {
  const rows: ReactNode[] = [];
  let lastGroup: string | null = null;

  for (const item of items) {
    if (item.kind === "separator") {
      rows.push(
        <div
          key={`sep-${rows.length}`}
          className="toolbar-popover-separator"
          aria-hidden="true"
        />,
      );
      lastGroup = null;
      continue;
    }

    if (item.kind === "status") {
      const status = item as ToolbarStatus;
      if (lastGroup !== null && lastGroup !== status.group) {
        rows.push(
          <div
            key={`sep-${rows.length}`}
            className="toolbar-popover-separator"
            aria-hidden="true"
          />,
        );
      }
      lastGroup = status.group;
      rows.push(
        <div
          key={status.id}
          className="toolbar-popover-item is-status"
          role="status"
        >
          <span className="toolbar-popover-item-label">{status.label}</span>
        </div>,
      );
      continue;
    }

    const a = item as ToolbarAction;

    if (lastGroup !== null && lastGroup !== a.group) {
      rows.push(
        <div
          key={`sep-${rows.length}`}
          className="toolbar-popover-separator"
          aria-hidden="true"
        />,
      );
    }
    lastGroup = a.group;

    rows.push(
      <button
        key={a.id}
        aria-label={a.label}
        className={`toolbar-popover-item${a.active ? " is-active" : ""}`}
        disabled={a.disabled}
        onClick={() => onAction(a.onRun)}
        type="button"
      >
        {a.iconId ? <ViewportToolSvg icon={a.iconId} /> : null}
        <span className="toolbar-popover-item-label">{a.label}</span>
        {a.active ? (
          <span className="toolbar-popover-item-check" aria-hidden="true">
            <svg viewBox="0 0 12 12" width="10" height="10">
              <path
                d="M2 6l3 3 5-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : null}
        {a.shortcut ? (
          <kbd className="toolbar-popover-item-shortcut">{a.shortcut}</kbd>
        ) : null}
      </button>,
    );
  }

  return <>{rows}</>;
}
