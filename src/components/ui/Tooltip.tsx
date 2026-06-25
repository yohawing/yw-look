import { useId, type ReactNode } from "react";

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

export function Tooltip({
  content,
  children,
  disabled = false,
  side = "top",
  size = "md",
  className,
}: TooltipProps) {
  const tooltipId = useId();
  const classes = ["yl-tooltip", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {children}
      {disabled ? null : (
        <span
          className="yl-tooltip__content"
          data-side={side}
          id={tooltipId}
          role="tooltip"
        >
          {content}
        </span>
      )}
    </span>
  );
}
