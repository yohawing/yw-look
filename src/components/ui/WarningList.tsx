import type { ReactNode } from "react";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

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
  return <ExclamationTriangleIcon aria-hidden="true" className={className} />;
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
