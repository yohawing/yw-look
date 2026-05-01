import type { SidebarTabItem } from "./SidebarTabs";
import { SidebarTabIcon, type SidebarTabId } from "./SidebarTabIcons";

export function createSidebarTabs(): SidebarTabItem<SidebarTabId>[] {
  return [
    {
      id: "properties",
      label: "Properties",
      icon: <SidebarTabIcon kind="properties" />,
    },
    {
      id: "hierarchy",
      label: "Outliner",
      icon: <SidebarTabIcon kind="hierarchy" />,
    },
    {
      id: "materials",
      label: "Materials",
      icon: <SidebarTabIcon kind="materials" />,
    },
    {
      id: "textures",
      label: "Textures",
      icon: <SidebarTabIcon kind="textures" />,
    },
    {
      id: "warnings",
      label: "Diagnostics",
      icon: <SidebarTabIcon kind="warnings" />,
    },
    { id: "file", label: "Files", icon: <SidebarTabIcon kind="file" /> },
    {
      id: "settings",
      label: "Settings",
      icon: <SidebarTabIcon kind="settings" />,
    },
  ];
}
