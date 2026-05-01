import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconTabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export function IconTabButton({
  active = false,
  className,
  type = "button",
  children,
  ...props
}: IconTabButtonProps) {
  const classes = ["yl-tab-button", className].filter(Boolean).join(" ");

  return (
    <button
      aria-selected={active}
      className={classes}
      data-active={active ? "true" : undefined}
      role="tab"
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
