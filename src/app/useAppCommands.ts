import { useCallback, useMemo } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DisplayMode } from "../components/AssetViewport";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { formatShortcut, menuShortcuts, type MenuActionId } from "../lib/menu";
import {
  applyViewerShortcutAction,
  viewerShortcutHelpLines,
  type ViewerShortcutAction,
} from "../lib/viewerShortcuts";
import type { FileState } from "../stores/fileStore";
import type { UiState } from "../stores/uiStore";
import { useViewerStore } from "../stores/viewerStore";

type PerformSelectFilePath = (
  path: string,
  reason: "navigation",
) => Promise<void>;

type UseAppCommandsOptions = {
  canNavigateNext: boolean;
  canNavigatePrev: boolean;
  directoryListing: FileState["directoryListing"];
  displayMode: DisplayMode;
  file: FileState;
  handleOpenFile: () => Promise<void>;
  isTauri: boolean;
  performSelectFilePath: PerformSelectFilePath;
  ui: UiState;
};

export function useAppCommands({
  canNavigateNext,
  canNavigatePrev,
  directoryListing,
  displayMode,
  file,
  handleOpenFile,
  isTauri,
  performSelectFilePath,
  ui,
}: UseAppCommandsOptions) {
  const showTexture = useViewerStore((state) => state.showTexture);
  const showWireframe = useViewerStore((state) => state.showWireframe);
  const showGrid = useViewerStore((state) => state.showGrid);
  const selectedMeshName = useViewerStore((state) => state.selectedMeshName);
  const selectedUsdPrimPath = useViewerStore(
    (state) => state.selectedUsdPrimPath,
  );
  const viewportShortcutCommand = useViewerStore(
    (state) => state.viewportShortcutCommand,
  );

  const shortcutLines = useMemo(
    () => [
      ...viewerShortcutHelpLines,
      ...Object.entries(menuShortcuts).map(([actionId, definition]) => {
        const actionLabel = actionId.split(".").join(" > ");
        return `${formatShortcut(definition)}  ${actionLabel}`;
      }),
    ],
    [],
  );

  const handleToggleFullscreen = useCallback(async () => {
    if (isTauri) {
      try {
        const currentWindow = getCurrentWindow();
        const next = !(await currentWindow.isFullscreen());
        await currentWindow.setFullscreen(next);
      } catch {
        // ignore
      }
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // ignore
    }
  }, [isTauri]);

  const handleShowShortcuts = useCallback(() => {
    ui.setDialogState({
      title: "Keyboard Shortcuts",
      lines: shortcutLines,
    });
  }, [shortcutLines, ui]);

  const handleShowAbout = useCallback(async () => {
    if (isTauri) {
      try {
        const version = await getVersion();
        ui.setDialogState({
          title: "About",
          lines: ["yw-look", `Version ${version}`],
        });
        return;
      } catch {
        // ignore
      }
    }

    ui.setDialogState({
      title: "About",
      lines: ["yw-look", "Browser preview mode"],
    });
  }, [isTauri, ui]);

  const executeMenuAction = useCallback(
    async (actionId: MenuActionId) => {
      switch (actionId) {
        case "file.open":
          await handleOpenFile();
          return;
        case "file.exit":
          if (isTauri) {
            try {
              await getCurrentWindow().close();
            } catch {
              // ignore
            }
          } else {
            window.close();
          }
          return;
        case "view.toggleTexture":
          useViewerStore.getState().toggleShowTexture();
          return;
        case "view.toggleWireframe":
          useViewerStore.getState().toggleShowWireframe();
          return;
        case "view.toggleGrid":
          useViewerStore.getState().toggleShowGrid();
          return;
        case "view.resetCamera":
          useViewerStore.getState().bumpResetVersion();
          return;
        case "view.toggleSidebar":
          ui.toggleSidebarOpen();
          return;
        case "window.toggleFullscreen":
          await handleToggleFullscreen();
          return;
        case "app.openSettings":
          ui.setSidebarOpen(true);
          ui.setActiveTab("settings");
          return;
        case "help.shortcuts":
          handleShowShortcuts();
          return;
        case "help.about":
          await handleShowAbout();
          return;
      }
    },
    [
      handleOpenFile,
      handleShowAbout,
      handleShowShortcuts,
      handleToggleFullscreen,
      isTauri,
      ui,
    ],
  );

  const executeViewerShortcutAction = useCallback(
    (action: ViewerShortcutAction) => {
      if (
        action === "focusSelected" ||
        action === "frameAll" ||
        action === "resetView"
      ) {
        useViewerStore.getState().setActiveCameraId(null);
      }

      const nextState = applyViewerShortcutAction(
        {
          showTexture,
          showWireframe,
          showGrid,
          selectedMeshName,
          selectedUsdPrimPath,
          viewportCommand: viewportShortcutCommand,
        },
        action,
        displayMode,
      );

      const viewer = useViewerStore.getState();
      if (nextState.showTexture !== showTexture) {
        viewer.setShowTexture(nextState.showTexture);
      }
      if (nextState.showWireframe !== showWireframe) {
        viewer.setShowWireframe(nextState.showWireframe);
      }
      if (nextState.showGrid !== showGrid) {
        viewer.setShowGrid(nextState.showGrid);
      }
      if (nextState.selectedMeshName !== selectedMeshName) {
        viewer.setSelectedMeshName(nextState.selectedMeshName);
      }
      if (nextState.selectedUsdPrimPath !== selectedUsdPrimPath) {
        viewer.setSelectedUsdPrimPath(nextState.selectedUsdPrimPath);
      }
      if (nextState.viewportCommand !== viewportShortcutCommand) {
        viewer.setViewportShortcutCommand(nextState.viewportCommand);
      }
    },
    [
      displayMode,
      selectedMeshName,
      selectedUsdPrimPath,
      showGrid,
      showTexture,
      showWireframe,
      viewportShortcutCommand,
    ],
  );

  const handleNavigateError = useCallback(
    (error: unknown) => {
      file.setOpenError(
        error instanceof Error ? error.message : "Failed to navigate to file.",
      );
    },
    [file],
  );

  useKeyboardShortcuts(
    canNavigatePrev,
    canNavigateNext,
    directoryListing,
    handleNavigateError,
    performSelectFilePath,
    executeViewerShortcutAction,
    executeMenuAction,
  );
}
