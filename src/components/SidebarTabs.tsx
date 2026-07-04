import type { ReactNode } from "react";
import "../styles/sidebar.css";
import { IconTabButton } from "./ui/IconTabButton";

export type SidebarTabItem<TabId extends string> = {
  id: TabId;
  label: string;
  icon: ReactNode;
  badge?: {
    label: string;
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
          <IconTabButton
            aria-label={tab.label}
            aria-pressed={isActive}
            className={`tab-button sidebar-tab-button${isActive ? " is-active" : ""}`}
            disabled={tab.disabled}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            selected={isActive}
            size="sm"
          >
            <span className="sidebar-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.badge ? (
              <span
                className={`sidebar-tab-badge is-${tab.badge.tone}`}
                aria-label={tab.badge.label}
              />
            ) : null}
          </IconTabButton>
        );
      })}
    </nav>
  );
}
