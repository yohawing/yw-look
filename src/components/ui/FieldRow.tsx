import type { HTMLAttributes, ReactNode } from "react";

export type FieldRowSize = "sm" | "md" | "lg";

export interface FieldRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  labelClassName?: string;
  controlClassName?: string;
  size?: FieldRowSize;
  children: ReactNode;
}

const sizeClass: Record<FieldRowSize, string> = {
  sm: "yl-field-row--sm",
  md: "",
  lg: "yl-field-row--lg",
};

export function FieldRow({
  label,
  labelClassName,
  controlClassName,
  size = "md",
  children,
  className,
  ...props
}: FieldRowProps) {
  const classes = ["yl-field-row", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");
  const labelClasses = ["yl-field-row__label", labelClassName]
    .filter(Boolean)
    .join(" ");
  const controlClasses = ["yl-field-row__control", controlClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...props}>
      <div className={labelClasses}>{label}</div>
      <div className={controlClasses}>{children}</div>
    </div>
  );
}
