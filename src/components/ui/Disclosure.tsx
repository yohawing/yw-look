import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "@radix-ui/react-icons";

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
  <ChevronRightIcon className="yl-disclosure__chevron" aria-hidden="true" />
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
