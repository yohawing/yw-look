import { useState, type ReactNode } from "react";

export type DisclosureVariant = "section" | "inline" | "minimal";

export interface DisclosureProps {
  title: ReactNode;
  children: ReactNode;
  variant?: DisclosureVariant;
  count?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

const chevron = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    className="yl-disclosure__chevron"
    aria-hidden="true"
  >
    <path
      d="M6 4l4 4-4 4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function Disclosure({
  title,
  children,
  variant = "section",
  count,
  defaultOpen = true,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  const classes = ["yl-disclosure", `yl-disclosure--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <details
      className={classes}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="yl-disclosure__summary">
        {chevron}
        <span className="yl-disclosure__title">{title}</span>
        {count != null ? (
          <span className="yl-disclosure__count">{count}</span>
        ) : null}
      </summary>
      <div className="yl-disclosure__body">{children}</div>
    </details>
  );
}
