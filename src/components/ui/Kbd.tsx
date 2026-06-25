import type { HTMLAttributes, ReactNode } from "react";

export type KbdSize = "sm" | "md" | "lg";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  size?: KbdSize;
  children: ReactNode;
}

const sizeClass: Record<KbdSize, string> = {
  sm: "yl-kbd--sm",
  md: "",
  lg: "yl-kbd--lg",
};

export function Kbd({ size = "md", className, children, ...props }: KbdProps) {
  const classes = ["yl-kbd", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <kbd className={classes} {...props}>
      {children}
    </kbd>
  );
}
