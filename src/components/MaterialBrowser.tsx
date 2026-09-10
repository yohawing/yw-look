import { useEffect, useRef, useState, type ReactNode } from "react";
import { SidebarSplitPanel } from "./ui/SidebarSplitPanel";
import { Badge } from "./ui/Badge";
import { SidebarEmpty } from "../lib/sidebarPrimitives";
import "../styles/material-list.css";

export type MaterialListItem = {
  id: string;
  name: string;
  color: string | null;
  meta: ReactNode;
  count: number;
};
/** Shared Materials layout for render materials and IFC semantic materials. */
export function MaterialBrowser({
  items,
  total,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  details,
  revealSelection = false,
}: {
  items: readonly MaterialListItem[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  details: ReactNode;
  revealSelection?: boolean;
}) {
  const lastRevealed = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 360 });
  const rowHeight = 48;
  const start = Math.max(
    0,
    Math.min(items.length - 1, Math.floor(viewport.top / rowHeight) - 6),
  );
  const end = Math.min(
    items.length,
    Math.ceil((viewport.top + viewport.height) / rowHeight) + 6,
  );
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () =>
      setViewport({ top: list.scrollTop, height: list.clientHeight || 360 });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    update();
    return () => observer.disconnect();
  }, [items.length]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);
  useEffect(() => {
    if (lastRevealed.current === selectedId) return;
    lastRevealed.current = selectedId;
    const index = items.findIndex((item) => item.id === selectedId);
    const list = listRef.current;
    if (!revealSelection || index < 0 || !list) return;
    const top = index * rowHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + rowHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = top + rowHeight - list.clientHeight;
    setViewport((current) => ({ ...current, top: list.scrollTop }));
  }, [selectedId, revealSelection, items]);
  return (
    <SidebarSplitPanel
      layoutId="materials"
      className="material-split-panel"
      handleClassName="material-resize-handle"
      resizeLabel="Resize material details"
      primary={{
        search: {
          ariaLabel: "Filter materials",
          clearLabel: "Clear material filter",
          onChange: onQueryChange,
          placeholder: "Search materials",
          value: query,
        },
        bodyClassName: "material-list-scroll",
        className: "material-list-pane",
        count: total,
        defaultSize: 58,
        id: "material-list",
        minSize: 24,
        title: "Materials",
        children: (
          <div className="material-list-layout">
            {total === 0 ? (
              <SidebarEmpty>No materials found.</SidebarEmpty>
            ) : !items.length ? (
              <SidebarEmpty>No materials match.</SidebarEmpty>
            ) : (
              <ul
                className="material-list"
                ref={listRef}
                onScroll={(event) =>
                  setViewport({
                    top: event.currentTarget.scrollTop,
                    height: event.currentTarget.clientHeight,
                  })
                }
              >
                <li
                  aria-hidden="true"
                  style={{ height: start * rowHeight, flexShrink: 0 }}
                />
                {items.slice(start, end).map((item) => (
                  <li key={item.id} className="material-item">
                    <button
                      className={`material-row${item.id === selectedId ? " is-selected" : ""}`}
                      aria-pressed={item.id === selectedId}
                      onClick={() => onSelect(item.id)}
                      type="button"
                    >
                      <span
                        className={`material-swatch${item.color ? "" : " material-swatch-none"}`}
                        style={
                          item.color ? { background: item.color } : undefined
                        }
                      />
                      <span className="material-info">
                        <span className="material-name">{item.name}</span>
                        <span className="material-meta">{item.meta}</span>
                      </span>
                      <Badge className="material-count-badge" mono size="sm">
                        {item.count}
                      </Badge>
                    </button>
                  </li>
                ))}
                <li
                  aria-hidden="true"
                  style={{
                    height: (items.length - end) * rowHeight,
                    flexShrink: 0,
                  }}
                />
              </ul>
            )}
          </div>
        ),
      }}
      secondary={{
        bodyClassName: "material-detail-scroll",
        children: details,
        className: "material-detail-pane",
        defaultSize: 42,
        id: "material-detail",
        minSize: 22,
        title: "Selected",
      }}
    />
  );
}
