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
import { useFileStore } from "../stores/fileStore";
import { useUiStore } from "../stores/uiStore";
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
  handleOpenFile: () => Promise<void>;
  isTauri: boolean;
  performSelectFilePath: PerformSelectFilePath;
};

export function useAppCommands({
  canNavigateNext,
  canNavigatePrev,
  directoryListing,
  displayMode,
  handleOpenFile,
  isTauri,
  performSelectFilePath,
}: UseAppCommandsOptions) {
  const setOpenError = useFileStore((state) => state.setOpenError);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setDialogState = useUiStore((state) => state.setDialogState);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const toggleSidebarOpen = useUiStore((state) => state.toggleSidebarOpen);
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
    setDialogState({
      title: "Keyboard Shortcuts",
      lines: shortcutLines,
    });
  }, [setDialogState, shortcutLines]);

  const handleShowAbout = useCallback(async () => {
    if (isTauri) {
      try {
        const version = await getVersion();
        setDialogState({
          title: "About",
          lines: ["yw-look", `Version ${version}`],
        });
        return;
      } catch {
        // ignore
      }
    }

    setDialogState({
      title: "About",
      lines: ["yw-look", "Browser preview mode"],
    });
  }, [isTauri, setDialogState]);

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
          toggleSidebarOpen();
          return;
        case "window.toggleFullscreen":
          await handleToggleFullscreen();
          return;
        case "app.openSettings":
          setSidebarOpen(true);
          setActiveTab("settings");
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
      setActiveTab,
      setSidebarOpen,
      toggleSidebarOpen,
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
      setOpenError(
        error instanceof Error ? error.message : "Failed to navigate to file.",
      );
    },
    [setOpenError],
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
