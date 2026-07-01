import type { HTMLAttributes, ReactNode } from "react";

export type SegmentedControlSize = "sm" | "md" | "lg";

export type SegmentedControlOption<TValue extends string = string> = {
  value: TValue;
  label: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
};

export interface SegmentedControlProps<
  TValue extends string = string,
> extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: TValue;
  options: readonly SegmentedControlOption<TValue>[];
  onValueChange: (value: TValue) => void;
  size?: SegmentedControlSize;
  disabled?: boolean;
}

const sizeClass: Record<SegmentedControlSize, string> = {
  sm: "yl-segmented-control--sm",
  md: "",
  lg: "yl-segmented-control--lg",
};

export function SegmentedControl<TValue extends string = string>({
  value,
  options,
  onValueChange,
  size = "md",
  disabled = false,
  className,
  ...props
}: SegmentedControlProps<TValue>) {
  const classes = ["yl-segmented-control", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="group" {...props}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            className="yl-segmented-control__option"
            disabled={disabled || option.disabled}
            key={option.value}
            onClick={() => onValueChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
