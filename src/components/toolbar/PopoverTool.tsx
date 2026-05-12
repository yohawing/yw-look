import { useCallback, useRef, useState, type ReactNode } from "react";
import { ViewportToolSvg } from "../ViewportToolIcons";
import type { ToolbarAction, ToolbarItem } from "./types";
import { ToolbarPopover } from "./ToolbarPopover";

type PopoverToolProps = {
  action: ToolbarAction;
};

export function PopoverTool({ action }: PopoverToolProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
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

  const handleTriggerClick = useCallback(() => {
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
    <>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup={hasChildren ? "menu" : undefined}
        aria-label={action.label}
        className={`viewport-tool${action.active ? " is-active" : ""}${open ? " is-hover" : ""}`}
        data-tooltip={action.description ?? action.label}
        onClick={handleTriggerClick}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        title={action.description ?? action.label}
        type="button"
      >
        {action.iconId ? <ViewportToolSvg icon={action.iconId} /> : null}
        {hasChildren ? (
          <span className="viewport-tool-popover-indicator" aria-hidden="true">
            <svg viewBox="0 0 10 10" width="6" height="6">
              <path d="M2 3l3 4 3-4" fill="currentColor" />
            </svg>
          </span>
        ) : null}
      </button>

      {hasChildren ? (
        <ToolbarPopover
          triggerRef={triggerRef}
          open={open}
          onClose={handleClose}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
        >
          <PopoverContent
            items={action.children!}
            onAction={handleChildAction}
          />
        </ToolbarPopover>
      ) : null}
    </>
  );
}

function PopoverContent({
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
