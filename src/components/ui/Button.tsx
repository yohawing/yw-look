import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "default" | "primary" | "subtle" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  children: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  default: "",
  primary: "yl-button--primary",
  subtle: "yl-button--subtle",
  ghost: "yl-button--ghost",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "yl-button--sm",
  md: "",
  lg: "yl-button--lg",
};

export function Button({
  variant = "default",
  size = "md",
  iconOnly = false,
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  const classes = [
    "yl-button",
    variantClass[variant],
    sizeClass[size],
    iconOnly ? "yl-button--icon" : "",
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
