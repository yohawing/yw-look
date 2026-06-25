import type { HTMLAttributes, ReactNode } from "react";

export type BadgeVariant = "neutral" | "success" | "warning" | "error" | "info";
export type BadgeSize = "sm" | "md" | "lg";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
}

const variantClass: Record<BadgeVariant, string> = {
  neutral: "",
  success: "yl-badge--success",
  warning: "yl-badge--warning",
  error: "yl-badge--error",
  info: "yl-badge--info",
};

const sizeClass: Record<BadgeSize, string> = {
  sm: "yl-badge--sm",
  md: "",
  lg: "yl-badge--lg",
};

export function Badge({
  variant = "neutral",
  size = "md",
  className,
  children,
  ...props
}: BadgeProps) {
  const classes = [
    "yl-badge",
    variantClass[variant],
    sizeClass[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}
