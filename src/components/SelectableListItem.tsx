import type { ReactNode } from "react";

export type SelectableListItemProps = {
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
};

export function SelectableListItem({
  onClick,
  children,
  className,
}: SelectableListItemProps) {
  const classes = ["yl-button", "yl-button--unstyled", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} onClick={onClick} type="button">
      {children}
    </button>
  );
}
