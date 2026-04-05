import { useEffect, useEffectEvent, useMemo, useState } from "react";
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
import { MetadataCard } from "./components/MetadataCard";
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

const sampleFormats = [
  "glb",
  "gltf",
  "fbx",
  "obj",
  "ply",
  "stl",
  "png",
  "jpg",
  "jpeg",
  "tga",
  "dds",
  "ktx2",
  "hdr",
  "exr",
  "usd",
];

const initialViewerFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};

const displayModeOptions: Array<{ value: DisplayMode; label: string }> = [
  { value: "untextured", label: "No Texture" },
  { value: "textured", label: "Textured" },
  { value: "wireframe", label: "Wireframe" },
  { value: "texturedWireframe", label: "Textured + Wire" },
];

const textureViewModeOptions: Array<{
  value: TextureViewMode;
  label: string;
}> = [
  { value: "rgb", label: "RGB" },
  { value: "rgba", label: "RGBA" },
  { value: "alpha", label: "Alpha" },
];

export function App() {
  const formatList = useMemo(() => sampleFormats.join(" / "), []);
  const [currentFile, setCurrentFile] = useState<SelectedFile | null>(null);
  const [directoryListing, setDirectoryListing] =
    useState<DirectoryListing | null>(null);
  const [viewerFeedback, setViewerFeedback] = useState<ViewerFeedback>(
    initialViewerFeedback,
  );
  const [displayMode, setDisplayMode] = useState<DisplayMode>("textured");
  const [openError, setOpenError] = useState<string | null>(null);
  const [isOpeningFile, setIsOpeningFile] = useState(false);
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
  const [textureViewMode, setTextureViewMode] =
    useState<TextureViewMode>("rgba");
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
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckPayload | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
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
  const hasTextureEntries = (assetMetadata?.textures.length ?? 0) > 0;
  const canShowTextureViewer =
    currentFile?.kind === "texture" || hasTextureEntries;
  const isHdrLikeTexture =
    currentFile?.extension === "hdr" || currentFile?.extension === "exr";
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
          error instanceof Error ? error.message : "Failed to load recent files.",
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

        selectFilePathFromEffect(firstPath, "open").catch((error: unknown) => {
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
        });
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((error: unknown) => {
        setOpenError(
          error instanceof Error
            ? error.message
            : "Failed to subscribe to drag and drop events.",
        );
      });

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
        void selectFilePathFromEffect(nextFile.path, "navigation").catch((error: unknown) => {
          setOpenError(
            error instanceof Error
              ? error.message
              : "Failed to navigate to previous file.",
          );
        });
      }

      if (event.key === "ArrowRight" && canNavigateNext) {
        event.preventDefault();
        const nextFile =
          directoryListing.files[directoryListing.currentIndex + 1];
        void selectFilePathFromEffect(nextFile.path, "navigation").catch((error: unknown) => {
          setOpenError(
            error instanceof Error
              ? error.message
              : "Failed to navigate to next file.",
          );
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canNavigateNext, canNavigatePrev, directoryListing]);

  const handleOpenFile = async () => {
    try {
      setIsOpeningFile(true);
      const selectedFile = await openFileDialog();

      if (!selectedFile) {
        return;
      }

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
    } finally {
      setIsOpeningFile(false);
    }
  };

  const navigateRelative = async (offset: -1 | 1) => {
    if (!directoryListing || directoryListing.currentIndex === null) {
      return;
    }

    const nextFile =
      directoryListing.files[directoryListing.currentIndex + offset];

    if (!nextFile) {
      return;
    }

    try {
      await performSelectFilePath(nextFile.path, "navigation");
    } catch (error: unknown) {
      setOpenError(
        error instanceof Error
          ? error.message
          : "Failed to navigate between files.",
      );
      setViewerFeedback((previous) => ({
        ...previous,
        mode: "loadFailed",
        message: "Navigation failed while resolving the next file.",
      }));
    }
  };

  const handleRetryCurrentFile = async () => {
    if (!currentFile) {
      return;
    }

    try {
      await performSelectFilePath(currentFile.path, "retry");
    } catch (error: unknown) {
      setOpenError(
        error instanceof Error ? error.message : "Retry failed for current file.",
      );
    }
  };

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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Asset Quick Look</p>
          <h1>yw-look</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={handleOpenFile} type="button">
            {isOpeningFile ? "Opening..." : "Open"}
          </button>
          <button
            disabled={!canNavigatePrev}
            onClick={() => void navigateRelative(-1)}
            type="button"
          >
            Prev
          </button>
          <button
            disabled={!canNavigateNext}
            onClick={() => void navigateRelative(1)}
            type="button"
          >
            Next
          </button>
          <button
            disabled={!viewerFeedback.canResetCamera}
            onClick={() => setResetVersion((value) => value + 1)}
            type="button"
          >
            Reset Camera
          </button>
        </div>
      </header>

      <section className="mode-strip" aria-label="Viewer controls hints">
        <span className="mode-strip-label">Controls</span>
        <span className="mode-chip is-static">Alt + Left: Orbit</span>
        <span className="mode-chip is-static">Alt + Middle: Pan</span>
        <span className="mode-chip is-static">Alt + Right: Zoom</span>
        <span className="mode-chip is-static">Wheel: Zoom</span>
        <span className="mode-chip is-static">Left / Right: Navigate</span>
      </section>

      <section className="mode-strip" aria-label="Display mode controls">
        <span className="mode-strip-label">Display</span>
        {displayModeOptions.map((option) => (
          <button
            key={option.value}
            className={
              option.value === displayMode ? "mode-chip is-active" : "mode-chip"
            }
            onClick={() => setDisplayMode(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </section>

      {canShowTextureViewer ? (
        <section className="mode-strip" aria-label="Texture viewer controls">
          <span className="mode-strip-label">Viewport</span>
          <button
            className={
              viewerSurfaceMode === "asset" ? "mode-chip is-active" : "mode-chip"
            }
            disabled={currentFile?.kind === "texture"}
            onClick={() => setViewerSurfaceMode("asset")}
            type="button"
          >
            3D View
          </button>
          <button
            className={
              viewerSurfaceMode === "texture"
                ? "mode-chip is-active"
                : "mode-chip"
            }
            disabled={!selectedTextureId}
            onClick={() => setViewerSurfaceMode("texture")}
            type="button"
          >
            Texture View
          </button>
          {viewerSurfaceMode === "texture" ? (
            <>
              <span className="mode-strip-label">Texture</span>
              {textureViewModeOptions.map((option) => (
                <button
                  key={option.value}
                  className={
                    option.value === textureViewMode
                      ? "mode-chip is-active"
                      : "mode-chip"
                  }
                  onClick={() => setTextureViewMode(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
              <label className="range-control">
                <span>Exposure {textureExposure.toFixed(2)}</span>
                <input
                  max={6}
                  min={-6}
                  onChange={(event) =>
                    setTextureExposure(Number(event.target.value))
                  }
                  step={0.05}
                  type="range"
                  value={textureExposure}
                />
              </label>
              <label className="range-control">
                <span>Black {textureBlackPoint.toFixed(2)}</span>
                <input
                  max={Math.max(textureWhitePoint - 0.01, 0)}
                  min={0}
                  onChange={(event) =>
                    setTextureBlackPoint(Number(event.target.value))
                  }
                  step={0.01}
                  type="range"
                  value={Math.min(textureBlackPoint, textureWhitePoint - 0.01)}
                />
              </label>
              <label className="range-control">
                <span>White {textureWhitePoint.toFixed(2)}</span>
                <input
                  max={8}
                  min={Math.min(textureBlackPoint + 0.01, 8)}
                  onChange={(event) =>
                    setTextureWhitePoint(Number(event.target.value))
                  }
                  step={0.01}
                  type="range"
                  value={textureWhitePoint}
                />
              </label>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="viewer-panel">
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
        />
        {isDragActive ? (
          <div className="drop-overlay">
            <p className="card-title">Drop Asset File</p>
            <p>Release to open the first supported file path.</p>
          </div>
        ) : null}
      </section>

      <section className="info-grid">
        <article className="card">
          <p className="card-title">Current Scope</p>
          <ul>
            <li>Native file dialog, drag and drop, and startup file intake</li>
            <li>Folder-aware previous and next navigation</li>
            <li>Three.js scene, camera, lighting, and RoomEnvironment</li>
            <li>Camera reset plus Alt-modified OrbitControls</li>
            <li>Display modes with stable material restoration</li>
            <li>Animation clip playback bar for animated model formats</li>
            <li>Texture viewer switching with RGB, RGBA, and Alpha channels</li>
            <li>Exposure and range controls for texture inspection</li>
          </ul>
        </article>

        <article className="card">
          <p className="card-title">Verification Samples</p>
          <p>{formatList}</p>
          <p className="muted">
            Runtime preview is focused on single-file assets first. More loaders
            will continue in the next sections.
          </p>
        </article>

        <article className="card">
          <p className="card-title">Viewer Status</p>
          <p>{viewerFeedback.message}</p>
          <p className="muted">Mode: {viewerStatusLabel}</p>
          <p className="muted">Display: {displayMode}</p>
          <p className="muted">Viewport: {viewerSurfaceMode}</p>
          {viewerSurfaceMode === "texture" ? (
            <p className="muted">
              Range: {textureBlackPoint.toFixed(2)} to{" "}
              {textureWhitePoint.toFixed(2)}
              {isHdrLikeTexture ? ` / exposure ${textureExposure.toFixed(2)}` : ""}
            </p>
          ) : null}
          {viewerFeedback.warning ? (
            <p className="warning-text">{viewerFeedback.warning}</p>
          ) : null}
        </article>

        <CurrentFileCard currentFile={currentFile} />
        <WarningsCard warnings={warnings} />
        <MetadataCard metadata={assetMetadata} />
        <HierarchyCard hierarchy={assetMetadata?.hierarchy ?? []} />
        <TextureListCard
          activeTextureId={selectedTextureId}
          onSelectTexture={(textureId) => {
            setSelectedTextureId(textureId);
            setViewerSurfaceMode("texture");
          }}
          textures={assetMetadata?.textures ?? []}
        />
        <SettingsCard
          settingsPayload={settingsPayload}
          settingsError={settingsError}
          onToggleFileAssociations={() => void handleToggleFileAssociations()}
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
            void performSelectFilePath(path, "recent").catch((error: unknown) => {
              setRecentFilesError(
                error instanceof Error
                  ? error.message
                  : "Failed to open recent file.",
              );
            });
          }}
          recentFilesError={recentFilesError}
          recentFilesPayload={recentFilesPayload}
        />
        <IntegrationCard
          integrationError={integrationError}
          integrationPayload={integrationPayload}
        />
        <DiagnosticsCard
          diagnosticsError={diagnosticsError}
          diagnosticsPayload={diagnosticsPayload}
        />
        <PerformanceCard snapshot={performanceSnapshot} />
        {openError ? (
          <article className="card">
            <p className="card-title">Open Error</p>
            <p className="error-text">{openError}</p>
            {currentFile ? (
              <button onClick={() => void handleRetryCurrentFile()} type="button">
                Retry
              </button>
            ) : null}
          </article>
        ) : null}
      </section>

      <footer className="statusbar">
        <span>
          Status:{" "}
          {settingsError
            ? "settings load failed"
            : `viewer ${viewerStatusLabel}`}
        </span>
        <span>Current file: {currentFileSummary}</span>
      </footer>
    </main>
  );
}
