import type { ReactNode } from "react";
import "../styles/sidebar.css";

export type AppStatusBarItem = {
  id: string;
  content: ReactNode;
  mono?: boolean;
  onClick?: () => void;
  tone?: "warning" | "danger";
};

type AppStatusBarProps = {
  leftItems: readonly AppStatusBarItem[];
  rightItems?: readonly AppStatusBarItem[];
  className?: string;
};

function StatusBarGroup({ items }: { items: readonly AppStatusBarItem[] }) {
  return (
    <div className="statusbar-group app-statusbar-group">
      {items.map((item, index) => (
        <span
          className={["app-statusbar-item", item.mono ? "statusbar-mono" : null]
            .filter(Boolean)
            .join(" ")}
          key={item.id}
        >
          {index > 0 ? (
            <span className="statusbar-separator" aria-hidden="true" />
          ) : null}
          {item.onClick ? (
            <button
              className={[
                "app-statusbar-item-content",
                "app-statusbar-button",
                item.tone ? `is-${item.tone}` : null,
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={item.onClick}
              type="button"
            >
              {item.content}
            </button>
          ) : (
            <span className="app-statusbar-item-content">{item.content}</span>
          )}
        </span>
      ))}
    </div>
  );
}

export function AppStatusBar({
  leftItems,
  rightItems = [],
  className,
}: AppStatusBarProps) {
  return (
    <footer
      className={["statusbar", "app-statusbar", className]
        .filter(Boolean)
        .join(" ")}
    >
      <StatusBarGroup items={leftItems} />
      <StatusBarGroup items={rightItems} />
    </footer>
  );
}
