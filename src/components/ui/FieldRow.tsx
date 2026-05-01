import type { HTMLAttributes, ReactNode } from "react";

export interface FieldRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  children: ReactNode;
}

export function FieldRow({
  label,
  children,
  className,
  ...props
}: FieldRowProps) {
  const classes = ["yl-field-row", className].filter(Boolean).join(" ");

  return (
    <div className={classes} {...props}>
      <div className="yl-field-row__label">{label}</div>
      <div className="yl-field-row__control">{children}</div>
    </div>
  );
}
