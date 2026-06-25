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
import type { ViewerState } from "../stores/viewerStore";

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
  viewer: ViewerState;
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
  viewer,
}: UseAppCommandsOptions) {
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
          viewer.toggleShowTexture();
          return;
        case "view.toggleWireframe":
          viewer.toggleShowWireframe();
          return;
        case "view.toggleGrid":
          viewer.toggleShowGrid();
          return;
        case "view.resetCamera":
          viewer.bumpResetVersion();
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
      viewer,
    ],
  );

  const executeViewerShortcutAction = useCallback(
    (action: ViewerShortcutAction) => {
      if (
        action === "focusSelected" ||
        action === "frameAll" ||
        action === "resetView"
      ) {
        viewer.setActiveCameraId(null);
      }

      const nextState = applyViewerShortcutAction(
        {
          showTexture: viewer.showTexture,
          showWireframe: viewer.showWireframe,
          showGrid: viewer.showGrid,
          selectedMeshName: viewer.selectedMeshName,
          selectedUsdPrimPath: viewer.selectedUsdPrimPath,
          viewportCommand: viewer.viewportShortcutCommand,
        },
        action,
        displayMode,
      );

      if (nextState.showTexture !== viewer.showTexture) {
        viewer.setShowTexture(nextState.showTexture);
      }
      if (nextState.showWireframe !== viewer.showWireframe) {
        viewer.setShowWireframe(nextState.showWireframe);
      }
      if (nextState.showGrid !== viewer.showGrid) {
        viewer.setShowGrid(nextState.showGrid);
      }
      if (nextState.selectedMeshName !== viewer.selectedMeshName) {
        viewer.setSelectedMeshName(nextState.selectedMeshName);
      }
      if (nextState.selectedUsdPrimPath !== viewer.selectedUsdPrimPath) {
        viewer.setSelectedUsdPrimPath(nextState.selectedUsdPrimPath);
      }
      if (nextState.viewportCommand !== viewer.viewportShortcutCommand) {
        viewer.setViewportShortcutCommand(nextState.viewportCommand);
      }
    },
    [displayMode, viewer],
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
