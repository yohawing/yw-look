import { useId, type ReactElement, type ReactNode } from "react";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: TooltipProps) {
  const tooltipId = useId();
  const classes = ["yl-tooltip", className].filter(Boolean).join(" ");

  return (
    <span className={classes}>
      {children}
      <span
        className="yl-tooltip__content"
        data-side={side}
        id={tooltipId}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}
