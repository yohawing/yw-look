import type { ReactNode } from "react";
import "../styles/sidebar.css";

export type SidebarTabItem<TabId extends string> = {
  id: TabId;
  label: string;
  icon: ReactNode;
  badge?: {
    count: number;
    tone: "warning" | "danger";
  };
  disabled?: boolean;
};

type SidebarTabsProps<TabId extends string> = {
  activeTab: TabId;
  tabs: readonly SidebarTabItem<TabId>[];
  onTabChange: (tabId: TabId) => void;
  ariaLabel?: string;
  className?: string;
};

export function SidebarTabs<TabId extends string>({
  activeTab,
  tabs,
  onTabChange,
  ariaLabel = "Sidebar sections",
  className,
}: SidebarTabsProps<TabId>) {
  return (
    <nav
      aria-label={ariaLabel}
      className={["sidebar-tabs", "sidebar-tabs-icon-only", className]
        .filter(Boolean)
        .join(" ")}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <button
            aria-label={tab.label}
            aria-pressed={isActive}
            className={`tab-button sidebar-tab-button${isActive ? " is-active" : ""}`}
            data-tooltip={tab.label}
            disabled={tab.disabled}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            type="button"
          >
            <span className="sidebar-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.badge && tab.badge.count > 0 ? (
              <span
                className={`sidebar-tab-badge is-${tab.badge.tone}`}
                aria-label={`${tab.badge.count} active diagnostics`}
              >
                {tab.badge.count > 99 ? "99+" : tab.badge.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
