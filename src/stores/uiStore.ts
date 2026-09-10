import {
  clampSidebarWidth,
  clampSelectedPercent,
  loadUiLayout,
  saveUiLayout,
} from "../lib/uiLayout";
import { create } from "zustand";
import type { SidebarTabId } from "../types/ui";

export interface UiState {
  activeTab: SidebarTabId;
  sidebarOpen: boolean;
  sidebarWidth: number;
  selectedPercent: number;
  setSelectedPercent: (v: number) => void;
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
  ...loadUiLayout(),
  setSelectedPercent: (value) =>
    set({ selectedPercent: clampSelectedPercent(value) }),
  viewportPanelOpen: true,
  isDragActive: false,
  dialogState: null,

  setActiveTab: (activeTab) => set({ activeTab }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarWidth: (sidebarWidth) =>
    set({ sidebarWidth: clampSidebarWidth(sidebarWidth) }),
  setViewportPanelOpen: (viewportPanelOpen) => set({ viewportPanelOpen }),
  setIsDragActive: (isDragActive) => set({ isDragActive }),
  setDialogState: (dialogState) => set({ dialogState }),
  toggleSidebarOpen: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

useUiStore.subscribe((state, previous) => {
  if (
    state.sidebarOpen !== previous.sidebarOpen ||
    state.sidebarWidth !== previous.sidebarWidth ||
    state.selectedPercent !== previous.selectedPercent
  )
    saveUiLayout(state);
});
