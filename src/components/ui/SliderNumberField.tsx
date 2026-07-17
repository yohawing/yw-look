import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { SliderField, type SliderFieldProps } from "./SliderField";

export interface SliderNumberFieldProps extends Omit<
  SliderFieldProps,
  "defaultValue" | "onChange" | "value" | "valueLabel"
> {
  value: number;
  onValueChange: (value: number) => void;
  numberInputAriaLabel?: string;
  numberInputClassName?: string;
  precision?: number;
}

function finiteNumber(value: SliderFieldProps["min"] | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatValue(value: number, precision: number) {
  return value.toFixed(Math.max(0, precision));
}

export function SliderNumberField({
  className,
  inputClassName,
  max,
  min,
  numberInputAriaLabel = "Slider value",
  numberInputClassName,
  onValueChange,
  precision = 2,
  size = "md",
  step,
  value,
  ...props
}: SliderNumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const minimum = finiteNumber(min);
  const maximum = finiteNumber(max);

  const clampValue = (nextValue: number) =>
    Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, nextValue));

  const commitDraft = (rawValue: string) => {
    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue) || rawValue.trim() === "") {
      return;
    }

    const clampedValue = clampValue(nextValue);
    onValueChange(clampedValue);
  };

  const handleNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    setDraft(rawValue);
    const nextValue = Number(rawValue);
    if (rawValue.trim() !== "" && Number.isFinite(nextValue)) {
      onValueChange(clampValue(nextValue));
    }
  };

  const handleNumberKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  const classes = ["yl-slider-number-field", className]
    .filter(Boolean)
    .join(" ");
  const numberInputClasses = [
    "yl-slider-number-field__input",
    numberInputClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <SliderField
        {...props}
        inputClassName={inputClassName}
        max={max}
        min={min}
        size={size}
        step={step}
        value={value}
        onChange={(event) => onValueChange(Number(event.currentTarget.value))}
      />
      <input
        aria-label={numberInputAriaLabel}
        className={numberInputClasses}
        max={max}
        min={min}
        step={step}
        type="number"
        value={draft ?? formatValue(value, precision)}
        onBlur={(event) => {
          commitDraft(event.currentTarget.value);
          setDraft(null);
        }}
        onChange={handleNumberChange}
        onFocus={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleNumberKeyDown}
      />
    </span>
  );
}
