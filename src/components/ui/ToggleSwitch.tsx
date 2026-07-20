import type { ButtonHTMLAttributes } from "react";

export type ToggleSwitchSize = "sm" | "md" | "lg";

export interface ToggleSwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: ToggleSwitchSize;
}

const sizeClass: Record<ToggleSwitchSize, string> = {
  sm: "yl-toggle--sm",
  md: "",
  lg: "yl-toggle--lg",
};

export function ToggleSwitch({
  checked,
  onCheckedChange,
  size = "md",
  className,
  disabled,
  type = "button",
  ...props
}: ToggleSwitchProps) {
  const classes = ["yl-toggle", sizeClass[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      className={classes}
      disabled={disabled}
      role="switch"
      type={type}
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented && !disabled) {
          onCheckedChange?.(!checked);
        }
      }}
    />
  );
}
