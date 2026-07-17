import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";

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

type SliderStyle = CSSProperties & {
  "--yl-slider-progress"?: string;
};

function sliderProgress(
  value: InputHTMLAttributes<HTMLInputElement>["value"],
  min: InputHTMLAttributes<HTMLInputElement>["min"],
  max: InputHTMLAttributes<HTMLInputElement>["max"],
) {
  const numericValue = Number(value ?? min ?? 0);
  const numericMin = Number(min ?? 0);
  const numericMax = Number(max ?? 100);
  const range = numericMax - numericMin;

  if (
    !Number.isFinite(numericValue) ||
    !Number.isFinite(numericMin) ||
    !Number.isFinite(numericMax) ||
    range <= 0
  ) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, ((numericValue - numericMin) / range) * 100),
  );
}

export function SliderField({
  label,
  valueLabel,
  size = "md",
  className,
  inputClassName,
  defaultValue,
  max,
  min,
  style,
  value,
  ...props
}: SliderFieldProps) {
  const classes = ["yl-slider-field", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");
  const inputClasses = ["yl-slider-field__control", inputClassName]
    .filter(Boolean)
    .join(" ");
  const inputStyle: SliderStyle = {
    ...style,
    "--yl-slider-progress": `${sliderProgress(value ?? defaultValue, min, max)}%`,
  };

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
      <input
        className={inputClasses}
        defaultValue={defaultValue}
        max={max}
        min={min}
        style={inputStyle}
        type="range"
        value={value}
        {...props}
      />
    </label>
  );
}
