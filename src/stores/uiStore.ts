import { clampSidebarWidth } from "../lib/uiLayout";
import { create } from "zustand";
import type { SidebarTabId } from "../types/ui";

export type SidebarLayoutId = "hierarchy" | "materials" | "textures";

export type DialogState =
  { kind: "shortcuts" } | { kind?: undefined; title: string; lines: string[] };

export interface UiState {
  activeTab: SidebarTabId;
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarLayouts: Partial<Record<SidebarLayoutId, Record<string, number>>>;
  setSidebarLayout: (
    id: SidebarLayoutId,
    layout: Record<string, number>,
  ) => void;
  viewportPanelOpen: boolean;
  isDragActive: boolean;
  dialogState: DialogState | null;

  setActiveTab: (v: SidebarTabId) => void;
  setSidebarOpen: (v: boolean) => void;
  setSidebarWidth: (v: number) => void;
  setViewportPanelOpen: (v: boolean) => void;
  setIsDragActive: (v: boolean) => void;
  setDialogState: (v: DialogState | null) => void;
  toggleSidebarOpen: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "properties",
  sidebarOpen: typeof window === "undefined" || window.innerWidth >= 720,
  sidebarWidth: clampSidebarWidth(350),
  sidebarLayouts: {},
  setSidebarLayout: (id, layout) =>
    set((state) => ({
      sidebarLayouts: { ...state.sidebarLayouts, [id]: layout },
    })),
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
