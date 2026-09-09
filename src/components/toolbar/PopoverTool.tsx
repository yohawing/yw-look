import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { CheckIcon } from "@radix-ui/react-icons";
import { ViewportToolSvg } from "../ViewportToolIcons";
import { PopoverContent, PopoverTrigger } from "../ui/Popover";
import type { ToolbarAction, ToolbarItem, ToolbarStatus } from "./types";
import { ToolbarPopover } from "./ToolbarPopover";
import { SliderField } from "../ui/SliderField";

type PopoverToolProps = {
  action: ToolbarAction;
};

const toolbarPopoverHoverEvent = "viewport-toolbar-popover-hover";

type ToolbarPopoverHoverEvent = CustomEvent<{ id: string }>;

function isToolbarPopoverInteractionTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    (target.closest(".viewport-controls") !== null ||
      target.closest(".toolbar-popover") !== null)
  );
}

export function PopoverTool({ action }: PopoverToolProps) {
  const [open, setOpen] = useState(false);
  const openModeRef = useRef<"hover" | "click" | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const hasChildren = action.children && action.children.length > 0;
  const hasSlider = action.children?.some((child) => child.kind === "slider");

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
    if (openModeRef.current !== "click") {
      openModeRef.current = "hover";
    }
    window.dispatchEvent(
      new CustomEvent(toolbarPopoverHoverEvent, { detail: { id: action.id } }),
    );
    if (!openTimerRef.current) {
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        setOpen(true);
      }, 120);
    }
  }, [action.id]);

  const scheduleClose = useCallback(() => {
    if (openModeRef.current === "click") {
      return;
    }
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!closeTimerRef.current) {
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setOpen(false);
      }, 180);
    }
  }, []);

  const handleClose = useCallback(() => {
    clearTimers();
    openModeRef.current = null;
    setOpen(false);
  }, [clearTimers]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      clearTimers();
      if (!nextOpen) {
        openModeRef.current = null;
      } else if (openModeRef.current === null) {
        openModeRef.current = "click";
      }
      setOpen(nextOpen);
    },
    [clearTimers],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (isToolbarPopoverInteractionTarget(event.target)) {
        return;
      }
      handleClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
    };
  }, [handleClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleToolbarHover = (event: Event) => {
      const nextId = (event as ToolbarPopoverHoverEvent).detail?.id;
      if (nextId !== action.id) {
        handleClose();
      }
    };

    window.addEventListener(toolbarPopoverHoverEvent, handleToolbarHover);
    return () => {
      window.removeEventListener(toolbarPopoverHoverEvent, handleToolbarHover);
    };
  }, [action.id, handleClose, open]);

  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent) => {
      if (isToolbarPopoverInteractionTarget(event.relatedTarget)) {
        return;
      }
      scheduleClose();
    },
    [scheduleClose],
  );

  const handleTriggerClick = useCallback(() => {
    clearTimers();
    if (hasChildren) {
      setOpen((current) => {
        const nextOpen = !current;
        openModeRef.current = nextOpen ? "click" : null;
        return nextOpen;
      });
      return;
    }
    if (action.kind === "toggle") {
      action.onRun?.();
      return;
    }
    if (action.onRun) {
      action.onRun();
      return;
    }
    if (open) {
      setOpen(false);
    }
  }, [action, clearTimers, hasChildren, open]);

  const handleChildAction = useCallback(
    (childOnRun?: () => void) => {
      clearTimers();
      if (childOnRun) {
        childOnRun();
      }
      setOpen(true);
    },
    [clearTimers],
  );

  return (
    <ToolbarPopover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-expanded={open}
          aria-haspopup={
            hasChildren ? (hasSlider ? "dialog" : "menu") : undefined
          }
          aria-label={action.label}
          className={`viewport-tool${action.active ? " is-active" : ""}${open ? " is-hover" : ""}`}
          disabled={action.disabled}
          onClick={handleTriggerClick}
          onPointerEnter={scheduleOpen}
          onPointerLeave={handlePointerLeave}
          type="button"
        >
          {action.iconId ? <ViewportToolSvg icon={action.iconId} /> : null}
        </button>
      </PopoverTrigger>

      {hasChildren ? (
        <PopoverContent
          align="start"
          className="toolbar-popover"
          role={hasSlider ? "dialog" : "menu"}
          aria-label={action.label}
          side="right"
          onPointerEnter={scheduleOpen}
          onPointerLeave={handlePointerLeave}
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

function ToolbarPopoverActionRow({
  action,
  onAction,
}: {
  action: ToolbarAction;
  onAction: (onRun?: () => void) => void;
}) {
  if (action.kind === "slider") {
    return (
      <div className="toolbar-popover-slider">
        <SliderField
          aria-label={action.label}
          label={action.label}
          valueLabel={action.valueLabel}
          value={action.value}
          min={action.min}
          max={action.max}
          step={action.step}
          disabled={action.disabled}
          size="sm"
          onChange={(event) =>
            action.onValueChange(Number(event.currentTarget.value))
          }
        />
      </div>
    );
  }
  return (
    <button
      aria-label={action.label}
      aria-pressed={action.active}
      className={`toolbar-popover-item${action.active ? " is-active" : ""}`}
      disabled={action.disabled}
      onClick={() => onAction(action.onRun)}
      type="button"
    >
      <span className="toolbar-popover-item-label">{action.label}</span>
      {action.active ? (
        <span className="toolbar-popover-item-check" aria-hidden="true">
          <CheckIcon aria-hidden="true" />
        </span>
      ) : null}
      {action.shortcut ? (
        <kbd className="toolbar-popover-item-shortcut">{action.shortcut}</kbd>
      ) : null}
    </button>
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
      <ToolbarPopoverActionRow key={a.id} action={a} onAction={onAction} />,
    );
  }

  return <>{rows}</>;
}
