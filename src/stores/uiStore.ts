import { create } from "zustand";
import type { SidebarTabId } from "../components/SidebarTabIcons";

export interface UiState {
  activeTab: SidebarTabId;
  sidebarOpen: boolean;
  sidebarWidth: number;
  viewportPanelOpen: boolean;
  isDragActive: boolean;
  dialogState: { title: string; lines: string[] } | null;

  setActiveTab: (v: SidebarTabId) => void;
  setSidebarOpen: (v: boolean) => void;
  setSidebarWidth: (v: number) => void;
  setViewportPanelOpen: (v: boolean) => void;
  setIsDragActive: (v: boolean) => void;
  setDialogState: (v: { title: string; lines: string[] } | null) => void;
  toggleSidebarOpen: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "properties",
  sidebarOpen: typeof window !== "undefined" ? window.innerWidth >= 720 : true,
  sidebarWidth: 350,
  viewportPanelOpen: true,
  isDragActive: false,
  dialogState: null,

  setActiveTab: (activeTab) => set({ activeTab }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setViewportPanelOpen: (viewportPanelOpen) => set({ viewportPanelOpen }),
  setIsDragActive: (isDragActive) => set({ isDragActive }),
  setDialogState: (dialogState) => set({ dialogState }),
  toggleSidebarOpen: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
