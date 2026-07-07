import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface SelectableListItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
}

export function SelectableListItem({
  children,
  className,
  type = "button",
  ...props
}: SelectableListItemProps) {
  const classes = [
    "yl-button",
    "yl-button--unstyled",
    "yl-selectable-list-item",
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
