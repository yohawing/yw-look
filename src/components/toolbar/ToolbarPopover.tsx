import type { ReactNode } from "react";
import { Popover } from "../ui/Popover";

type ToolbarPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export function ToolbarPopover({
  open,
  onOpenChange,
  children,
}: ToolbarPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {children}
    </Popover>
  );
}
