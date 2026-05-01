import type { ButtonHTMLAttributes } from "react";

export interface ToggleSwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function ToggleSwitch({
  checked,
  onCheckedChange,
  className,
  disabled,
  type = "button",
  ...props
}: ToggleSwitchProps) {
  const classes = ["yl-toggle", className].filter(Boolean).join(" ");

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
