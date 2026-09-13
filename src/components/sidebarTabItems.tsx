import { t } from "../lib/i18n";
import type { SidebarTabItem } from "./SidebarTabs";
import { SidebarTabIcon, type SidebarTabId } from "./SidebarTabIcons";

export function createSidebarTabs(): SidebarTabItem<SidebarTabId>[] {
  return [
    {
      id: "properties",
      label: t("properties"),
      icon: <SidebarTabIcon kind="properties" />,
    },
    {
      id: "hierarchy",
      label: t("outliner"),
      icon: <SidebarTabIcon kind="hierarchy" />,
    },
    {
      id: "materials",
      label: t("materials"),
      icon: <SidebarTabIcon kind="materials" />,
    },
    {
      id: "textures",
      label: t("textures"),
      icon: <SidebarTabIcon kind="textures" />,
    },
    {
      id: "warnings",
      label: t("diagnostics"),
      icon: <SidebarTabIcon kind="warnings" />,
    },
    { id: "file", label: t("files"), icon: <SidebarTabIcon kind="file" /> },
    {
      id: "settings",
      label: t("settings"),
      icon: <SidebarTabIcon kind="settings" />,
    },
  ];
}
