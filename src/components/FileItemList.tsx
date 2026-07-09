import type { ReactNode } from "react";
import { SelectableListItem } from "./ui";

export type FileItemListEntry = {
  id: string;
  name: ReactNode;
  secondary?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  className?: string;
  onSelect: () => void;
};

export type FileItemListProps = {
  items: readonly FileItemListEntry[];
  className?: string;
};

export function FileItemList({ items, className }: FileItemListProps) {
  const listClassName = ["file-item-list", className].filter(Boolean).join(" ");

  return (
    <ul className={listClassName}>
      {items.map((item) => (
        <li key={item.id}>
          <SelectableListItem
            className={[
              "file-item-row",
              item.selected ? "is-current" : null,
              item.className,
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={item.onSelect}
            aria-current={item.selected ? "true" : undefined}
          >
            <span className="file-item-thumb" aria-hidden="true">
              {item.leading}
            </span>
            <span className="file-item-info">
              <span className="file-item-name">{item.name}</span>
              {item.secondary && (
                <span className="file-item-secondary">{item.secondary}</span>
              )}
            </span>
            {item.trailing && (
              <span className="file-item-meta">{item.trailing}</span>
            )}
          </SelectableListItem>
        </li>
      ))}
    </ul>
  );
}
