import type { InputHTMLAttributes, ReactNode } from "react";

export type SliderFieldSize = "sm" | "md" | "lg";

export interface SliderFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "size" | "type"
> {
  label?: ReactNode;
  valueLabel?: ReactNode;
  size?: SliderFieldSize;
  className?: string;
  inputClassName?: string;
}

const sizeClass: Record<SliderFieldSize, string> = {
  sm: "yl-slider-field--sm",
  md: "",
  lg: "yl-slider-field--lg",
};

export function SliderField({
  label,
  valueLabel,
  size = "md",
  className,
  inputClassName,
  ...props
}: SliderFieldProps) {
  const classes = ["yl-slider-field", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");
  const inputClasses = ["yl-slider-field__control", inputClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={classes}>
      {label || valueLabel ? (
        <span className="yl-slider-field__head">
          {label ? (
            <span className="yl-slider-field__label">{label}</span>
          ) : null}
          {valueLabel ? (
            <span className="yl-slider-field__value">{valueLabel}</span>
          ) : null}
        </span>
      ) : null}
      <input className={inputClasses} type="range" {...props} />
    </label>
  );
}
