import type { ReactNode } from "react";

export type WarningListDensity = "regular" | "summary";

export type WarningListProps = {
  warnings: readonly string[];
  className?: string;
  density?: WarningListDensity;
  maxItems?: number;
  showItemIcons?: boolean;
  title?: ReactNode;
};

type WarningIconProps = {
  className?: string;
};

export function WarningIcon({ className }: WarningIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="14"
      viewBox="0 0 16 16"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 1.5L1.5 13.5h13L8 1.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M8 6v4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="11.5" fill="currentColor" r="0.6" />
    </svg>
  );
}

export function WarningList({
  warnings,
  className,
  density = "regular",
  maxItems,
  showItemIcons = density === "regular",
  title,
}: WarningListProps) {
  const visibleWarnings =
    typeof maxItems === "number" ? warnings.slice(0, maxItems) : warnings;
  const classes = [
    "yl-warning-list",
    density === "summary" ? "yl-warning-list--summary" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {title ? (
        <span className="yl-warning-list__title">
          <WarningIcon className="yl-warning-list__icon" />
          <span>{title}</span>
        </span>
      ) : null}
      <ul className="yl-warning-list__items">
        {visibleWarnings.map((warning, index) => (
          <li className="yl-warning-list__item" key={`${warning}:${index}`}>
            {showItemIcons ? (
              <WarningIcon className="yl-warning-list__icon" />
            ) : null}
            <span className="yl-warning-list__text">{warning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
