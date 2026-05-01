import type { SidebarTabItem } from "./SidebarTabs";
import { SidebarTabIcon, type SidebarTabId } from "./SidebarTabIcons";

export function createSidebarTabs(): SidebarTabItem<SidebarTabId>[] {
  return [
    { id: "file", label: "Files", icon: <SidebarTabIcon kind="file" /> },
    {
      id: "hierarchy",
      label: "Hierarchy",
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
      id: "settings",
      label: "Settings",
      icon: <SidebarTabIcon kind="settings" />,
    },
    {
      id: "warnings",
      label: "Warnings",
      icon: <SidebarTabIcon kind="warnings" />,
    },
  ];
}
