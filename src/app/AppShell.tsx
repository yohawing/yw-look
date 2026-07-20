import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { AppStatusBar } from "../components/AppStatusBar";
import { SidebarTabs } from "../components/SidebarTabs";
import type { SidebarTabItem } from "../components/SidebarTabs";
import type { SidebarTabId } from "../components/SidebarTabIcons";
import { Dialog, DialogContent } from "../components/ui/Dialog";
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
  banner?: ReactNode;
  viewport: ReactNode;
};

export function AppShell({
  activeTab,
  banner,
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
  const dialogLines = dialogState?.lines.join("\n") ?? "";

  return (
    <main className="app-shell">
      <section className="main-content">
        {banner}
        {viewport}
      </section>

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

      <Dialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) {
            onCloseDialog();
          }
        }}
      >
        {dialogState ? (
          <DialogContent title={dialogState.title}>
            <pre className="yl-dialog__body">{dialogLines}</pre>
          </DialogContent>
        ) : null}
      </Dialog>

      <AppStatusBar leftItems={statusLeftItems} rightItems={statusRightItems} />
    </main>
  );
}
