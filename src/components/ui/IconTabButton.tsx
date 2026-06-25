import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconTabButtonSize = "sm" | "md" | "lg";

export interface IconTabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  selected?: boolean;
  size?: IconTabButtonSize;
  children: ReactNode;
}

const sizeClass: Record<IconTabButtonSize, string> = {
  sm: "yl-tab-button--sm",
  md: "",
  lg: "yl-tab-button--lg",
};

export function IconTabButton({
  active = false,
  selected,
  size = "md",
  className,
  type = "button",
  children,
  ...props
}: IconTabButtonProps) {
  const isSelected = selected ?? active;
  const classes = ["yl-tab-button", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-selected={isSelected}
      className={classes}
      data-active={isSelected ? "true" : undefined}
      role="tab"
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
