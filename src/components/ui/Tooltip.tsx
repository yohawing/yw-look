import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { isValidElement, type ReactElement, type ReactNode } from "react";

export type TooltipSide = "top" | "right" | "bottom" | "left";
export type TooltipSize = "sm" | "md" | "lg";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  side?: TooltipSide;
  size?: TooltipSize;
  className?: string;
}

const sizeClass: Record<TooltipSize, string> = {
  sm: "yl-tooltip--sm",
  md: "",
  lg: "yl-tooltip--lg",
};

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  disabled = false,
  side = "top",
  size = "md",
  className,
}: TooltipProps) {
  const classes = ["yl-tooltip__content", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");

  if (disabled || content === null || content === undefined) {
    return <>{children}</>;
  }

  const trigger = isValidElement(children) ? (
    (children as ReactElement)
  ) : (
    <span className="yl-tooltip__trigger">{children}</span>
  );

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{trigger}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={classes}
          side={side}
          sideOffset={7}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
