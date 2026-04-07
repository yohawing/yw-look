import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AssetViewport,
  type DisplayMode,
  type TextureViewMode,
  type ViewerFeedback,
  type ViewerSurfaceMode,
} from "./components/AssetViewport";
import {
  emptyAssetMetadata,
  type AssetMetadata,
} from "./components/assetMetadata";
import { CurrentFileCard } from "./components/CurrentFileCard";
import { DiagnosticsCard } from "./components/DiagnosticsCard";
import { HierarchyCard } from "./components/HierarchyCard";
import { IntegrationCard } from "./components/IntegrationCard";
import { MaterialListCard } from "./components/MaterialListCard";
import { MenuBar } from "./components/MenuBar";
import {
  PerformanceCard,
  type PerformanceSnapshot,
} from "./components/PerformanceCard";
import { RecentFilesCard } from "./components/RecentFilesCard";
import { SettingsCard } from "./components/SettingsCard";
import { TextureListCard } from "./components/TextureListCard";
import { UpdateCard } from "./components/UpdateCard";
import { WarningsCard } from "./components/WarningsCard";
import {
  loadDiagnosticsSnapshot,
  logDiagnosticEvent,
  type DiagnosticsPayload,
} from "./lib/diagnostics";
import {
  getStartupFile,
  listSupportedSiblings,
  openFileDialog,
  resolveSelectedFile,
  type DirectoryListing,
  type SelectedFile,
} from "./lib/files";
import { prefetchAdjacent } from "./viewer";
import {
  loadSupportedExtensions,
  type IntegrationPayload,
} from "./lib/integrations";
import { loadRecentFiles, type RecentFilesPayload } from "./lib/recentFiles";
import { isTauriEnvironment } from "./lib/platform";
import {
  formatShortcut,
  menuShortcuts,
  resolveShortcutAction,
  type MenuActionId,
} from "./lib/menu";
import {
  checkForUpdate,
  installPendingUpdate,
  loadUpdateConfiguration,
  type UpdateCheckPayload,
  type UpdateConfigurationPayload,
} from "./lib/updater";
import {
  loadSettings,
  saveSettings,
  type SettingsPayload,
} from "./lib/settings";

type SidebarTab =
  | "file"
  | "hierarchy"
  | "materials"
  | "textures"
  | "settings"
  | "warnings";

const initialViewerFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};

function deriveDisplayMode(
  showTexture: boolean,
  showWireframe: boolean,
): DisplayMode {
  if (showTexture && showWireframe) return "texturedWireframe";
  if (showTexture) return "textured";
  if (showWireframe) return "wireframe";
  return "untextured";
}

export function App() {
  const [activeTab, setActiveTab] = useState<SidebarTab>("file");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showTexture, setShowTexture] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [gridUnitLabel, setGridUnitLabel] = useState("1 m");
  const [currentFile, setCurrentFile] = useState<SelectedFile | null>(null);
  const [directoryListing, setDirectoryListing] =
    useState<DirectoryListing | null>(null);
  const [viewerFeedback, setViewerFeedback] = useState<ViewerFeedback>(
    initialViewerFeedback,
  );
  const displayMode = deriveDisplayMode(showTexture, showWireframe);
  const [openError, setOpenError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [settingsPayload, setSettingsPayload] =
    useState<SettingsPayload | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [assetMetadata, setAssetMetadata] = useState<AssetMetadata | null>(
    emptyAssetMetadata,
  );
  const [viewerSurfaceMode, setViewerSurfaceMode] =
    useState<ViewerSurfaceMode>("asset");
  const [selectedTextureId, setSelectedTextureId] = useState<string | null>(
    null,
  );
  const [textureViewMode] = useState<TextureViewMode>("rgba");
  const [textureExposure, setTextureExposure] = useState(0);
  const [textureBlackPoint, setTextureBlackPoint] = useState(0);
  const [textureWhitePoint, setTextureWhitePoint] = useState(1);
  const [recentFilesPayload, setRecentFilesPayload] =
    useState<RecentFilesPayload | null>(null);
  const [recentFilesError, setRecentFilesError] = useState<string | null>(null);
  const [diagnosticsPayload, setDiagnosticsPayload] =
    useState<DiagnosticsPayload | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [integrationPayload, setIntegrationPayload] =
    useState<IntegrationPayload | null>(null);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [updateConfiguration, setUpdateConfiguration] =
    useState<UpdateConfigurationPayload | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckPayload | null>(
    null,
  );
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [dialogState, setDialogState] = useState<{
    title: string;
    lines: string[];
  } | null>(null);
  const [performanceSnapshot, setPerformanceSnapshot] =
    useState<PerformanceSnapshot>({
      startupMs: null,
      loadMs: null,
      navigationMs: null,
    });

  const viewerStatusLabel = useMemo(() => {
    switch (viewerFeedback.mode) {
      case "loading":
        return "loading preview";
      case "ready":
        return "preview ready";
      case "unsupported":
        return "unsupported format";
      case "loadFailed":
        return "preview failed";
      case "missingReference":
        return "missing external resource";
      default:
        return "idle";
    }
  }, [viewerFeedback.mode]);

  const currentFileSummary = useMemo(() => {
    if (!currentFile) {
      return "none";
    }

    if (
      directoryListing?.currentIndex !== null &&
      directoryListing?.files.length
    ) {
      return `${currentFile.fileName} (${directoryListing.currentIndex + 1}/${directoryListing.files.length})`;
    }

    return `${currentFile.fileName} (${currentFile.kind})`;
  }, [currentFile, directoryListing]);

  const canNavigatePrev =
    directoryListing !== null &&
    directoryListing.currentIndex !== null &&
    directoryListing.currentIndex > 0 &&
    directoryListing.files.length > 0;
  const canNavigateNext =
    directoryListing !== null &&
    directoryListing.currentIndex !== null &&
    directoryListing.currentIndex < directoryListing.files.length - 1;
  const warnings = useMemo(() => {
    const nextWarnings: string[] = [];

    if (viewerFeedback.warning) {
      nextWarnings.push(viewerFeedback.warning);
    }

    for (const texture of assetMetadata?.textures ?? []) {
      if (texture.sourceKind === "unresolved") {
        nextWarnings.push(`Texture reference is unresolved: ${texture.label}`);
      }
    }

    return nextWarnings;
  }, [assetMetadata?.textures, viewerFeedback.warning]);
  const isTauri = isTauriEnvironment();
  const shortcutLines = useMemo(
    () =>
      Object.entries(menuShortcuts).map(([actionId, definition]) => {
        const actionLabel = actionId.split(".").join(" > ");
        return `${formatShortcut(definition)}  ${actionLabel}`;
      }),
    [],
  );

  useEffect(() => {
    let isActive = true;

    loadSettings()
      .then((payload) => {
        if (!isActive) {
          return;
        }

        setSettingsPayload(payload);
        setSettingsError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setSettingsError(
          error instanceof Error ? error.message : "Failed to load settings.",
        );
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    setPerformanceSnapshot((previous) => ({
      ...previous,
      startupMs: performance.now(),
    }));
  }, []);

  useEffect(() => {
    let isActive = true;

    loadRecentFiles()
      .then((payload) => {
        if (!isActive) {
          return;
        }

        setRecentFilesPayload(payload);
        setRecentFilesError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setRecentFilesError(
          error instanceof Error
            ? error.message
            : "Failed to load recent files.",
        );
      });

    return () => {
      isActive = false;
    };
  }, [currentFile]);

  const refreshDiagnostics = useEffectEvent(async () => {
    try {
      const payload = await loadDiagnosticsSnapshot();
      setDiagnosticsPayload(payload);
      setDiagnosticsError(null);
    } catch (error: unknown) {
      setDiagnosticsError(
        error instanceof Error
          ? error.message
          : "Failed to load diagnostics snapshot.",
      );
    }
  });

  useEffect(() => {
    void refreshDiagnostics();
  }, []);

  const refreshUpdateConfiguration = async () => {
    try {
      const payload = await loadUpdateConfiguration();
      setUpdateConfiguration(payload);
      setUpdateError(null);
    } catch (error: unknown) {
      setUpdateError(
        error instanceof Error
          ? error.message
          : "Failed to load updater configuration.",
      );
    }
  };

  useEffect(() => {
    void refreshUpdateConfiguration();
  }, []);

  useEffect(() => {
    let isActive = true;

    loadSupportedExtensions()
      .then((payload) => {
        if (!isActive) {
          return;
        }

        setIntegrationPayload(payload);
        setIntegrationError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setIntegrationError(
          error instanceof Error
            ? error.message
            : "Failed to load Windows integration details.",
        );
      });

    return () => {
      isActive = false;
    };
  }, [settingsPayload?.settings.fileAssociationsEnabled]);

  useEffect(() => {
    if (!currentFile) {
      if (selectedTextureId !== null) {
        setSelectedTextureId(null);
      }
      if (viewerSurfaceMode !== "asset") {
        setViewerSurfaceMode("asset");
      }
      setTextureExposure(0);
      setTextureBlackPoint(0);
      setTextureWhitePoint(1);
      return;
    }

    const firstTextureId = assetMetadata?.textures[0]?.id ?? null;

    if (currentFile.kind === "texture") {
      if (selectedTextureId !== firstTextureId) {
        setSelectedTextureId(firstTextureId);
      }
      if (viewerSurfaceMode !== "texture") {
        setViewerSurfaceMode("texture");
      }
      if (currentFile.extension === "hdr" || currentFile.extension === "exr") {
        setTextureExposure(0.75);
        setTextureWhitePoint(4);
      }
      return;
    }

    const hasSelectedTexture = assetMetadata?.textures.some(
      (texture) => texture.id === selectedTextureId,
    );

    if (!hasSelectedTexture && selectedTextureId !== firstTextureId) {
      setSelectedTextureId(firstTextureId);
    }

    if (!firstTextureId && viewerSurfaceMode === "texture") {
      setViewerSurfaceMode("asset");
    }
  }, [assetMetadata, currentFile, selectedTextureId, viewerSurfaceMode]);

  useEffect(() => {
    if (!openError) {
      return;
    }

    void (async () => {
      await logDiagnosticEvent({
        code: "APP_OPEN_ERROR",
        level: "error",
        message: openError,
        contextPath: currentFile?.path ?? null,
      });
      await refreshDiagnostics();
    })();
  }, [currentFile?.path, openError]);

  useEffect(() => {
    if (viewerFeedback.mode === "ready" || viewerFeedback.mode === "empty") {
      return;
    }

    void (async () => {
      await logDiagnosticEvent({
        code: `VIEWER_${viewerFeedback.mode.toUpperCase()}`,
        level:
          viewerFeedback.mode === "missingReference" ||
          viewerFeedback.mode === "unsupported"
            ? "warn"
            : "error",
        message: viewerFeedback.message,
        detail: viewerFeedback.warning,
        contextPath: currentFile?.path ?? null,
      });
      await refreshDiagnostics();
    })();
  }, [
    currentFile?.path,
    viewerFeedback.message,
    viewerFeedback.mode,
    viewerFeedback.warning,
  ]);

  const performSelectFilePath = async (
    path: string,
    reason: "open" | "startup" | "navigation" | "retry" | "recent" = "open",
  ) => {
    const startedAt = performance.now();
    setOpenError(null);
    setViewerFeedback((previous) => ({
      ...previous,
      mode: "loading",
      message: `Resolving ${path}`,
      warning: null,
      canResetCamera: false,
    }));

    const [resolvedFile, listing] = await Promise.all([
      resolveSelectedFile(path),
      listSupportedSiblings(path),
    ]);

    setCurrentFile(resolvedFile);
    setDirectoryListing(listing);
    prefetchAdjacent(listing.files, listing.currentIndex);
    const elapsed = performance.now() - startedAt;
    setPerformanceSnapshot((previous) => ({
      ...previous,
      loadMs: elapsed,
      navigationMs: reason === "navigation" ? elapsed : previous.navigationMs,
    }));
  };

  const selectFilePathFromEffect = useEffectEvent(
    async (
      path: string,
      reason: "open" | "startup" | "navigation" | "retry" | "recent" = "open",
    ) => {
      await performSelectFilePath(path, reason);
    },
  );

  useEffect(() => {
    let isActive = true;

    getStartupFile()
      .then((startupFile) => {
        if (!isActive || !startupFile) {
          return;
        }

        return selectFilePathFromEffect(startupFile.path, "startup");
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setOpenError(
          error instanceof Error
            ? error.message
            : "Failed to resolve startup file.",
        );
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    try {
      getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDragActive(true);
            return;
          }

          if (event.payload.type === "leave") {
            setIsDragActive(false);
            return;
          }

          setIsDragActive(false);
          const [firstPath] = event.payload.paths;

          if (!firstPath) {
            return;
          }

          selectFilePathFromEffect(firstPath, "open").catch(
            (error: unknown) => {
              setOpenError(
                error instanceof Error
                  ? error.message
                  : "Failed to open dropped file.",
              );
              setViewerFeedback((previous) => ({
                ...previous,
                mode: "loadFailed",
                message: "Dropped file could not be resolved.",
              }));
            },
          );
        })
        .then((dispose) => {
          unlisten = dispose;
        })
        .catch(() => {
          // Tauri API unavailable (browser dev mode)
        });
    } catch {
      // Tauri API unavailable (browser dev mode)
    }

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (
        isTyping ||
        !directoryListing ||
        directoryListing.currentIndex === null
      ) {
        return;
      }

      if (event.key === "ArrowLeft" && canNavigatePrev) {
        event.preventDefault();
        const nextFile =
          directoryListing.files[directoryListing.currentIndex - 1];
        void selectFilePathFromEffect(nextFile.path, "navigation").catch(
          (error: unknown) => {
            setOpenError(
              error instanceof Error
                ? error.message
                : "Failed to navigate to previous file.",
            );
          },
        );
      }

      if (event.key === "ArrowRight" && canNavigateNext) {
        event.preventDefault();
        const nextFile =
          directoryListing.files[directoryListing.currentIndex + 1];
        void selectFilePathFromEffect(nextFile.path, "navigation").catch(
          (error: unknown) => {
            setOpenError(
              error instanceof Error
                ? error.message
                : "Failed to navigate to next file.",
            );
          },
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canNavigateNext, canNavigatePrev, directoryListing]);

  const handleOpenFile = async () => {
    try {
      const selectedFile = await openFileDialog();
      if (!selectedFile) return;
      await performSelectFilePath(selectedFile.path, "open");
    } catch (error: unknown) {
      setOpenError(
        error instanceof Error ? error.message : "Failed to open file dialog.",
      );
      setViewerFeedback((previous) => ({
        ...previous,
        mode: "loadFailed",
        message: "File dialog operation failed.",
      }));
    }
  };

  const handleOpenRecentFile = async (path: string) => {
    try {
      await performSelectFilePath(path, "recent");
    } catch (error: unknown) {
      setRecentFilesError(
        error instanceof Error ? error.message : "Failed to open recent file.",
      );
    }
  };

  const handleToggleFullscreen = async () => {
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
  };

  const handleShowShortcuts = () => {
    setDialogState({
      title: "Keyboard Shortcuts",
      lines: shortcutLines,
    });
  };

  const handleShowAbout = async () => {
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
  };

  const executeMenuAction = async (actionId: MenuActionId) => {
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
        setShowTexture((value) => !value);
        return;
      case "view.toggleWireframe":
        setShowWireframe((value) => !value);
        return;
      case "view.toggleGrid":
        setShowGrid((value) => !value);
        return;
      case "view.resetCamera":
        setResetVersion((value) => value + 1);
        return;
      case "view.toggleSidebar":
        setSidebarOpen((value) => !value);
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
  };
  const runMenuActionFromShortcut = useEffectEvent((actionId: MenuActionId) => {
    void executeMenuAction(actionId);
  });

  useEffect(() => {
    const handleShortcutDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const actionId = resolveShortcutAction(event);
      if (!actionId) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isTyping) {
        return;
      }

      event.preventDefault();
      runMenuActionFromShortcut(actionId);
    };

    window.addEventListener("keydown", handleShortcutDown);
    return () => {
      window.removeEventListener("keydown", handleShortcutDown);
    };
  }, []);

  const handleToggleFileAssociations = async () => {
    if (!settingsPayload) {
      return;
    }

    try {
      const nextPayload = await saveSettings({
        ...settingsPayload.settings,
        fileAssociationsEnabled:
          !settingsPayload.settings.fileAssociationsEnabled,
      });
      setSettingsPayload(nextPayload);
      setSettingsError(null);
    } catch (error: unknown) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Failed to update file association setting.",
      );
    }
  };

  const handleSaveUpdateSettings = async ({
    endpoint,
    publicKey,
    allowInsecure,
  }: {
    endpoint: string;
    publicKey: string;
    allowInsecure: boolean;
  }) => {
    if (!settingsPayload) {
      return;
    }

    try {
      const nextPayload = await saveSettings({
        ...settingsPayload.settings,
        updateEndpointOverride: endpoint.trim() || null,
        updatePublicKeyOverride: publicKey.trim() || null,
        allowInsecureUpdateEndpoint: allowInsecure,
      });
      setSettingsPayload(nextPayload);
      setSettingsError(null);
      await refreshUpdateConfiguration();
    } catch (error: unknown) {
      setUpdateError(
        error instanceof Error
          ? error.message
          : "Failed to save updater settings.",
      );
    }
  };

  const handleCheckForUpdate = async () => {
    try {
      setIsCheckingForUpdate(true);
      const payload = await checkForUpdate();
      setUpdateCheck(payload);
      setUpdateConfiguration(payload.configuration);
      setUpdateError(null);
    } catch (error: unknown) {
      setUpdateError(
        error instanceof Error ? error.message : "Failed to check for updates.",
      );
    } finally {
      setIsCheckingForUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    try {
      setIsInstallingUpdate(true);
      const payload = await installPendingUpdate();
      setUpdateError(payload.note);
      setUpdateCheck(null);
    } catch (error: unknown) {
      setUpdateError(
        error instanceof Error ? error.message : "Failed to install update.",
      );
    } finally {
      setIsInstallingUpdate(false);
    }
  };

  const sidebarContent = (() => {
    switch (activeTab) {
      case "file":
        return (
          <>
            <CurrentFileCard
              currentFile={currentFile}
              metadata={assetMetadata}
            />
            <PerformanceCard snapshot={performanceSnapshot} />
          </>
        );
      case "hierarchy":
        return <HierarchyCard hierarchy={assetMetadata?.hierarchy ?? []} />;
      case "materials":
        return <MaterialListCard materials={assetMetadata?.materials ?? []} />;
      case "textures":
        return (
          <TextureListCard
            activeTextureId={selectedTextureId}
            onSelectTexture={(textureId) => {
              if (
                textureId === selectedTextureId &&
                viewerSurfaceMode === "texture"
              ) {
                setViewerSurfaceMode("asset");
              } else {
                setSelectedTextureId(textureId);
                setViewerSurfaceMode("texture");
              }
            }}
            textures={assetMetadata?.textures ?? []}
          />
        );
      case "settings":
        return (
          <>
            <SettingsCard
              settingsPayload={settingsPayload}
              settingsError={settingsError}
              onToggleFileAssociations={() =>
                void handleToggleFileAssociations()
              }
            />
            <UpdateCard
              key={`${settingsPayload?.settings.updateEndpointOverride ?? ""}:${settingsPayload?.settings.updatePublicKeyOverride ?? ""}:${settingsPayload?.settings.allowInsecureUpdateEndpoint ?? false}`}
              isCheckingForUpdate={isCheckingForUpdate}
              isInstallingUpdate={isInstallingUpdate}
              onCheckForUpdate={() => void handleCheckForUpdate()}
              onInstallUpdate={() => void handleInstallUpdate()}
              onSaveOverride={(draft) => void handleSaveUpdateSettings(draft)}
              updateCheck={updateCheck}
              updateConfiguration={updateConfiguration}
              updateError={updateError}
            />
            <RecentFilesCard
              onOpenPath={(path) => {
                void performSelectFilePath(path, "recent").catch(
                  (error: unknown) => {
                    setRecentFilesError(
                      error instanceof Error
                        ? error.message
                        : "Failed to open recent file.",
                    );
                  },
                );
              }}
              recentFilesError={recentFilesError}
              recentFilesPayload={recentFilesPayload}
            />
            <IntegrationCard
              integrationError={integrationError}
              integrationPayload={integrationPayload}
            />
          </>
        );
      case "warnings":
        return (
          <>
            <WarningsCard warnings={warnings} />
            <DiagnosticsCard
              diagnosticsError={diagnosticsError}
              diagnosticsPayload={diagnosticsPayload}
            />
          </>
        );
    }
  })();

  return (
    <main className="app-shell">
      {/* ── MenuBar ── */}
      {isTauri ? (
        <div className="menubar menubar-hidden" />
      ) : (
        <MenuBar
          onAction={(actionId) => {
            void executeMenuAction(actionId);
          }}
          onOpenRecentFile={(path) => {
            void handleOpenRecentFile(path);
          }}
          recentFiles={recentFilesPayload?.entries ?? []}
        />
      )}

      {/* ── Viewport ── */}
      <section className="main-content">
        <div className="viewer-panel">
          <AssetViewport
            currentFile={currentFile}
            displayMode={displayMode}
            onFeedbackChange={setViewerFeedback}
            onMetadataChange={setAssetMetadata}
            selectedTextureId={selectedTextureId}
            textureViewMode={textureViewMode}
            viewerSurfaceMode={viewerSurfaceMode}
            textureExposure={textureExposure}
            textureBlackPoint={textureBlackPoint}
            textureWhitePoint={textureWhitePoint}
            resetVersion={resetVersion}
            showGrid={showGrid}
            onGridUnitChange={setGridUnitLabel}
          />

          {/* ViewModeControls overlay */}
          <div className="view-mode-controls">
            <button
              className={`view-mode-toggle${showTexture ? " is-active" : ""}`}
              onClick={() => setShowTexture((v) => !v)}
              type="button"
            >
              <span>Texture</span>
              <span className={`toggle-switch${showTexture ? " is-on" : ""}`} />
            </button>
            <button
              className={`view-mode-toggle${showWireframe ? " is-active" : ""}`}
              onClick={() => setShowWireframe((v) => !v)}
              type="button"
            >
              <span>Wireframe</span>
              <span
                className={`toggle-switch${showWireframe ? " is-on" : ""}`}
              />
            </button>
            <button
              className={`view-mode-toggle${showGrid ? " is-active" : ""}`}
              onClick={() => setShowGrid((v) => !v)}
              type="button"
            >
              <span>Grid</span>
              <span className={`toggle-switch${showGrid ? " is-on" : ""}`} />
            </button>
          </div>

          {/* InfoPanel toggle button */}
          <button
            className={`info-panel-toggle${sidebarOpen ? " is-active" : ""}`}
            onClick={() => setSidebarOpen((v) => !v)}
            type="button"
            title={sidebarOpen ? "Close Info Panel" : "Open Info Panel"}
          >
            <svg
              viewBox="0 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="2"
                y="2"
                width="14"
                height="14"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path d="M11 2v14" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M13.5 6h1M13.5 9h1M13.5 12h1"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {/* Texture mode banner */}
          {viewerSurfaceMode === "texture" ? (
            <button
              className="texture-mode-banner"
              onClick={() => setViewerSurfaceMode("asset")}
              type="button"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8.5 2L4 7l4.5 5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Back to 3D View
            </button>
          ) : null}

          {/* Drop overlay */}
          {isDragActive ? (
            <div className="drop-overlay">
              <p>Drop file to open</p>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Sidebar ── */}
      <aside className={`sidebar${sidebarOpen ? " is-open" : ""}`}>
        <nav className="sidebar-tabs">
          <button
            className={`tab-button${activeTab === "file" ? " is-active" : ""}`}
            onClick={() => setActiveTab("file")}
            type="button"
            title="File Info"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 1.5h5.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path d="M9 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className={`tab-button${activeTab === "hierarchy" ? " is-active" : ""}`}
            onClick={() => setActiveTab("hierarchy")}
            type="button"
            title="Hierarchy"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="4"
                cy="4"
                r="2"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <circle
                cx="12"
                cy="4"
                r="2"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <circle
                cx="8"
                cy="12"
                r="2"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M5 5.5L7 10.5M11 5.5L9 10.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
          <button
            className={`tab-button${activeTab === "materials" ? " is-active" : ""}`}
            onClick={() => setActiveTab("materials")}
            type="button"
            title="Materials"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="8"
                cy="8"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.5" />
              <path
                d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className={`tab-button${activeTab === "textures" ? " is-active" : ""}`}
            onClick={() => setActiveTab("textures")}
            type="button"
            title="Textures"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="2"
                y="2"
                width="12"
                height="12"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <circle
                cx="5.5"
                cy="5.5"
                r="1.5"
                stroke="currentColor"
                strokeWidth="1"
              />
              <path
                d="M2 11l3-3 2 2 3-4 4 5v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1Z"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
            </svg>
          </button>
          <button
            className={`tab-button${activeTab === "settings" ? " is-active" : ""}`}
            onClick={() => setActiveTab("settings")}
            type="button"
            title="Settings"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="8"
                cy="8"
                r="2.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className={`tab-button${activeTab === "warnings" ? " is-active" : ""}`}
            onClick={() => setActiveTab("warnings")}
            type="button"
            title="Warnings"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 1.5L1.5 13.5h13L8 1.5Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <path
                d="M8 6v4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <circle cx="8" cy="11.5" r="0.6" fill="currentColor" />
            </svg>
          </button>
        </nav>
        <div className="sidebar-content">{sidebarContent}</div>
      </aside>

      {dialogState ? (
        <div
          className="dialog-backdrop"
          onClick={() => setDialogState(null)}
          role="presentation"
        >
          <section
            aria-labelledby="dialog-title"
            aria-modal
            className="dialog-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="dialog-header">
              <p className="card-title" id="dialog-title">
                {dialogState.title}
              </p>
              <button
                className="menubar-button"
                onClick={() => setDialogState(null)}
                type="button"
              >
                Close
              </button>
            </header>
            <pre className="dialog-body">{dialogState.lines.join("\n")}</pre>
          </section>
        </div>
      ) : null}

      {/* ── StatusBar ── */}
      <footer className="statusbar">
        <div className="statusbar-group">
          {currentFile ? (
            <>
              <span>
                {viewerFeedback.mode === "loading"
                  ? `Loading: ${currentFile.fileName}`
                  : `Model loaded: ${currentFile.fileName}`}
              </span>
              {assetMetadata && assetMetadata.meshCount > 0 ? (
                <>
                  <span className="statusbar-separator" />
                  <span>{assetMetadata.meshCount} meshes</span>
                </>
              ) : null}
              {assetMetadata && assetMetadata.materialCount > 0 ? (
                <>
                  <span className="statusbar-separator" />
                  <span>{assetMetadata.materialCount} materials</span>
                </>
              ) : null}
              {showGrid ? (
                <>
                  <span className="statusbar-separator" />
                  <span>Grid: {gridUnitLabel}</span>
                </>
              ) : null}
            </>
          ) : (
            <span>
              {settingsError
                ? "Settings load failed"
                : `Viewer: ${viewerStatusLabel}`}
            </span>
          )}
        </div>
        <div className="statusbar-group">
          {performanceSnapshot.loadMs !== null ? (
            <>
              <span className="statusbar-mono">
                Load: {performanceSnapshot.loadMs.toFixed(0)}ms
              </span>
              <span className="statusbar-separator" />
            </>
          ) : null}
          <span className="statusbar-mono">{currentFileSummary}</span>
        </div>
      </footer>
    </main>
  );
}
