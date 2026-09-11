import { Activity, useState, type ReactNode } from "react";
import type { SidebarTabId } from "../types/ui";

/** Keep visited tabs, including DOM scroll/expansion, without hidden Effects. */
export function SidebarPanels({
  activeTab,
  fileIdentity,
  renderPanel,
}: {
  activeTab: SidebarTabId;
  fileIdentity: string | null;
  renderPanel: (tab: SidebarTabId) => ReactNode;
}) {
  const [visited, setVisited] = useState<SidebarTabId[]>([activeTab]);
  if (!visited.includes(activeTab)) setVisited([...visited, activeTab]);

  return visited.map((tab) => (
    <Activity key={tab} mode={tab === activeTab ? "visible" : "hidden"}>
      <div
        key={tab === "settings" || tab === "file" ? tab : fileIdentity}
        className="sidebar-tab-content"
        data-sidebar-panel={tab}
      >
        {renderPanel(tab)}
      </div>
    </Activity>
  ));
}
