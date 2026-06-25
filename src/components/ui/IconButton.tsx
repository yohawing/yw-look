import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonVariant = "default" | "primary" | "subtle" | "ghost";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
}

const variantClass: Record<IconButtonVariant, string> = {
  default: "",
  primary: "yl-button--primary",
  subtle: "yl-button--subtle",
  ghost: "yl-button--ghost",
};

const sizeClass: Record<IconButtonSize, string> = {
  sm: "yl-icon-button--sm",
  md: "",
  lg: "yl-icon-button--lg",
};

export function IconButton({
  variant = "default",
  size = "md",
  className,
  type = "button",
  children,
  ...props
}: IconButtonProps) {
  const classes = [
    "yl-button",
    "yl-icon-button",
    variantClass[variant],
    sizeClass[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  );
}
