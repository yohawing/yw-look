import type { ReactNode, SelectHTMLAttributes } from "react";

export type SelectFieldSize = "sm" | "md" | "lg";

export interface SelectFieldProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "className" | "size"
> {
  label?: ReactNode;
  size?: SelectFieldSize;
  className?: string;
  selectClassName?: string;
  children: ReactNode;
}

const sizeClass: Record<SelectFieldSize, string> = {
  sm: "yl-select-field--sm",
  md: "",
  lg: "yl-select-field--lg",
};

export function SelectField({
  label,
  size = "md",
  className,
  selectClassName,
  children,
  ...props
}: SelectFieldProps) {
  const classes = ["yl-select-field", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");
  const selectClasses = ["yl-select-field__control", selectClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={classes}>
      {label ? <span className="yl-select-field__label">{label}</span> : null}
      <select className={selectClasses} {...props}>
        {children}
      </select>
    </label>
  );
}
