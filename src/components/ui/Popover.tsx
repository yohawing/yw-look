import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentPropsWithoutRef } from "react";

export type PopoverContentProps = ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
>;

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: PopoverContentProps) {
  const classes = ["yl-popover__content", className].filter(Boolean).join(" ");

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className={classes}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
