import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { AppStatusBar } from "../components/AppStatusBar";
import { SidebarTabs } from "../components/SidebarTabs";
import type { SidebarTabItem } from "../components/SidebarTabs";
import type { SidebarTabId } from "../components/SidebarTabIcons";
import type { UiState } from "../stores/uiStore";
import type { AppStatusBarItem } from "../types/ui";

type AppShellProps = {
  dialogState: UiState["dialogState"];
  handleSidebarResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onCloseDialog: () => void;
  onTabChange: (tab: SidebarTabId) => void;
  sidebarContent: ReactNode;
  sidebarOpen: boolean;
  sidebarTabs: SidebarTabItem<SidebarTabId>[];
  sidebarWidth: number;
  statusLeftItems: AppStatusBarItem[];
  statusRightItems: AppStatusBarItem[];
  activeTab: SidebarTabId;
  viewport: ReactNode;
};

export function AppShell({
  activeTab,
  dialogState,
  handleSidebarResizeStart,
  onCloseDialog,
  onTabChange,
  sidebarContent,
  sidebarOpen,
  sidebarTabs,
  sidebarWidth,
  statusLeftItems,
  statusRightItems,
  viewport,
}: AppShellProps) {
  return (
    <main className="app-shell">
      <section className="main-content">{viewport}</section>

      <aside
        className={`sidebar${sidebarOpen ? " is-open" : ""}`}
        style={
          sidebarOpen
            ? ({
                "--sidebar-width": `${sidebarWidth}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div
          aria-hidden="true"
          className="sidebar-resize-handle"
          onPointerDown={handleSidebarResizeStart}
        />
        <SidebarTabs
          activeTab={activeTab}
          onTabChange={onTabChange}
          tabs={sidebarTabs}
        />
        <div className="sidebar-content">{sidebarContent}</div>
      </aside>

      {dialogState ? (
        <div
          className="dialog-backdrop"
          onClick={onCloseDialog}
          role="presentation"
        >
          <section
            aria-labelledby="dialog-title"
            aria-modal
            className="dialog-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="dialog-header">
              <p className="card-title" id="dialog-title">
                {dialogState.title}
              </p>
              <button
                className="dialog-close-button"
                onClick={onCloseDialog}
                type="button"
              >
                Close
              </button>
            </header>
            <pre className="dialog-body">{dialogState.lines.join("\n")}</pre>
          </section>
        </div>
      ) : null}

      <AppStatusBar leftItems={statusLeftItems} rightItems={statusRightItems} />
    </main>
  );
}
