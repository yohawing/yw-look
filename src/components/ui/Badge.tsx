import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export type BadgeVariant = "neutral" | "success" | "warning" | "error" | "info";
export type BadgeSize = "sm" | "md" | "lg";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  mono?: boolean;
  uppercase?: boolean;
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
  mono = false,
  uppercase = false,
  className,
  children,
  ...props
}: BadgeProps) {
  const classes = getBadgeClasses({
    className,
    mono,
    size,
    uppercase,
    variant,
  });

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

export interface BadgeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  mono?: boolean;
  uppercase?: boolean;
  children: ReactNode;
}

export function BadgeButton({
  variant = "neutral",
  size = "md",
  mono = false,
  uppercase = false,
  className,
  children,
  type = "button",
  ...props
}: BadgeButtonProps) {
  const classes = getBadgeClasses({
    className,
    interactive: true,
    mono,
    size,
    uppercase,
    variant,
  });

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  );
}

function getBadgeClasses({
  className,
  interactive = false,
  mono,
  size,
  uppercase,
  variant,
}: {
  className?: string;
  interactive?: boolean;
  mono: boolean;
  size: BadgeSize;
  uppercase: boolean;
  variant: BadgeVariant;
}) {
  return [
    "yl-badge",
    variantClass[variant],
    sizeClass[size],
    mono ? "yl-badge--mono" : null,
    uppercase ? "yl-badge--uppercase" : null,
    interactive ? "yl-badge--interactive" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}
