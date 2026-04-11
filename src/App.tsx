import {
  Suspense,
  lazy,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AssetViewport,
  type BackgroundPreset,
  type CameraPreset,
  type CameraPresetRequest,
  type DisplayMode,
  type EnvironmentPreset,
  type TextureViewMode,
  type ToneMappingMode,
  type ViewerFeedback,
  type ViewerSurfaceMode,
} from "./components/AssetViewport";
import {
  emptyAssetMetadata,
  type AssetMetadata,
} from "./components/assetMetadata";
import { CurrentFileCard } from "./components/CurrentFileCard";
import { HierarchyCard } from "./components/HierarchyCard";
import { MaterialListCard } from "./components/MaterialListCard";
import { MenuBar } from "./components/MenuBar";
import {
  PerformanceCard,
  type PerformanceSnapshot,
} from "./components/PerformanceCard";
import { TextureListCard } from "./components/TextureListCard";
import { UsdInspectorCard } from "./components/UsdInspectorCard";
import { WarningsCard } from "./components/WarningsCard";
import {
  collectAssetIssues,
  inspectStage,
  summarizeStage,
  type AssetIssue,
  type StageInspection,
  type StageSummary,
} from "./lib/usd";
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
  isMenuActionId,
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

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadline) => void,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const USD_EXTENSIONS = new Set(["usd", "usda", "usdc", "usdz"]);

function isUsdFile(file: SelectedFile | null): boolean {
  return !!file && USD_EXTENSIONS.has(file.extension);
}

/**
 * Format one `AssetIssue` as a single-line string so it can be funneled
 * into the existing `warnings: string[]` pipeline consumed by
 * `WarningsCard`. Phase 2 intentionally keeps WarningsCard on its string
 * contract; a structured `Issue` variant is a Phase 3 concern.
 */
function formatAssetIssue(issue: AssetIssue): string {
  const prefix = issue.level === "error" ? "USD error" : "USD warning";
  const context = issue.contextPath ? ` (${issue.contextPath})` : "";
  return `${prefix}: ${issue.message}${context}`;
}

const initialViewerFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};
const TIME_TO_INTERACTIVE_TIMEOUT_MS = 1500;

function deriveDisplayMode(
  showTexture: boolean,
  showWireframe: boolean,
): DisplayMode {
  if (showTexture && showWireframe) return "texturedWireframe";
  if (showTexture) return "textured";
  if (showWireframe) return "wireframe";
  return "untextured";
}

const environmentPresets: Array<{
  id: EnvironmentPreset;
  label: string;
}> = [
  { id: "studio", label: "Studio" },
  { id: "neutral", label: "Neutral" },
  { id: "outdoor", label: "Outdoor" },
];

const DiagnosticsCard = lazy(() =>
  import("./components/DiagnosticsCard").then((module) => ({
    default: module.DiagnosticsCard,
  })),
);
const IntegrationCard = lazy(() =>
  import("./components/IntegrationCard").then((module) => ({
    default: module.IntegrationCard,
  })),
);
const RecentFilesCard = lazy(() =>
  import("./components/RecentFilesCard").then((module) => ({
    default: module.RecentFilesCard,
  })),
);
const SettingsCard = lazy(() =>
  import("./components/SettingsCard").then((module) => ({
    default: module.SettingsCard,
  })),
);
const UpdateCard = lazy(() =>
  import("./components/UpdateCard").then((module) => ({
    default: module.UpdateCard,
  })),
);

function SidebarCardFallback() {
  return (
    <article className="card">
      <p className="muted">Loading panel…</p>
    </article>
  );
}

const backgroundPresetOptions: Array<{
  id: BackgroundPreset;
  label: string;
}> = [
  { id: "gray", label: "Gray" },
  { id: "charcoal", label: "Dark" },
  { id: "light", label: "Light" },
];

const cameraPresetOptions: Array<{
  id: CameraPreset;
  label: string;
}> = [
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];

const toneMappingOptions: Array<{
  id: ToneMappingMode;
  label: string;
}> = [
  { id: "linear", label: "Linear" },
  { id: "aces", label: "ACES" },
  { id: "reinhard", label: "Reinhard" },
];

const textureChannelOptions: Array<{
  id: TextureViewMode;
  label: string;
}> = [
  { id: "rgb", label: "RGB" },
  { id: "rgba", label: "RGBA" },
  { id: "r", label: "R" },
  { id: "g", label: "G" },
  { id: "b", label: "B" },
  { id: "alpha", label: "A" },
];

const textureTileOptions: Array<{
  count: number;
  label: string;
}> = [
  { count: 1, label: "1x" },
  { count: 2, label: "2x" },
  { count: 4, label: "4x" },
  { count: 8, label: "8x" },
];

const renderScaleOptions: Array<{
  value: number;
  label: string;
}> = [
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
];

const DEFAULT_EXPOSURE = 1.1;

export function App() {
  const appStartRef = useRef(performance.now());
  const [activeTab, setActiveTab] = useState<SidebarTab>("file");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showTexture, setShowTexture] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(false);
  const [showNormals, setShowNormals] = useState(false);
  const [showVertexColors, setShowVertexColors] = useState(false);
  const [viewportPanelOpen, setViewportPanelOpen] = useState(true);
  const [showEnvironmentBackground, setShowEnvironmentBackground] =
    useState(false);
  const [environmentRotation, setEnvironmentRotation] = useState(0);
  const [backfaceCulling, setBackfaceCulling] = useState(true);
  const [cameraPresetRequest, setCameraPresetRequest] =
    useState<CameraPresetRequest | null>(null);
  const [controlSensitivity, setControlSensitivity] = useState(1);
  const [cameraFov, setCameraFov] = useState(45);
  const [renderScale, setRenderScale] = useState(1);
  const [toneMappingMode, setToneMappingMode] =
    useState<ToneMappingMode>("aces");
  const [exposure, setExposure] = useState(DEFAULT_EXPOSURE);
  const [backgroundPreset, setBackgroundPreset] =
    useState<BackgroundPreset>("gray");
  const [environmentPreset, setEnvironmentPreset] =
    useState<EnvironmentPreset>("studio");
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
  const [textureViewMode, setTextureViewMode] =
    useState<TextureViewMode>("rgba");
  const [textureExposure, setTextureExposure] = useState(0);
  const [textureBlackPoint, setTextureBlackPoint] = useState(0);
  const [textureWhitePoint, setTextureWhitePoint] = useState(1);
  const [textureTileCount, setTextureTileCount] = useState(1);
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
      firstPaintMs: null,
      interactiveMs: null,
    });
  const [usdSummary, setUsdSummary] = useState<StageSummary | null>(null);
  const [usdInspection, setUsdInspection] = useState<StageInspection | null>(
    null,
  );
  const [usdIssues, setUsdIssues] = useState<AssetIssue[]>([]);
  const [usdInspectorLoading, setUsdInspectorLoading] = useState(false);
  const [usdInspectorError, setUsdInspectorError] = useState<string | null>(
    null,
  );
  const isTauri = isTauriEnvironment();
  // Browser mode needs recent files immediately for the always-visible MenuBar.
  // Tauri can keep this deferred until the sidebar is opened.
  const shouldLoadRecentFiles = sidebarOpen || !isTauri;
  const shouldLoadDeferredData = sidebarOpen;

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

    // Phase 2: surface Rust-side USD asset hygiene issues in the existing
    // warnings pipeline. Errors sort before warnings so broken references
    // are visible first.
    const sortedIssues = [...usdIssues].sort((a, b) => {
      if (a.level === b.level) return 0;
      return a.level === "error" ? -1 : 1;
    });
    for (const issue of sortedIssues) {
      nextWarnings.push(formatAssetIssue(issue));
    }

    return nextWarnings;
  }, [assetMetadata?.textures, usdIssues, viewerFeedback.warning]);
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

  // Phase 2 USD inspector pipeline. Runs in parallel with the Three.js
  // load path in AssetViewport, so the sidebar can show stage summary /
  // inspection / asset issues before the heavy USDLoader parse finishes.
  // See docs/usd.md.
  useEffect(() => {
    if (!isTauri || !isUsdFile(currentFile) || !currentFile) {
      setUsdSummary(null);
      setUsdInspection(null);
      setUsdIssues([]);
      setUsdInspectorLoading(false);
      setUsdInspectorError(null);
      return;
    }

    let cancelled = false;
    setUsdSummary(null);
    setUsdInspection(null);
    setUsdIssues([]);
    setUsdInspectorLoading(true);
    setUsdInspectorError(null);

    const path = currentFile.path;

    // Summary resolves first and updates the UI immediately; the heavier
    // inspection and asset-issue RPCs land later. We only drop the
    // `loading` flag once ALL three settle so the card cannot flicker
    // back to its "Open a USD…" empty state when the fastest RPC wins
    // the race (e.g. `collect_asset_issues` returning an empty list
    // before `summarize_stage` has produced any output).
    const summarizePromise = summarizeStage(path)
      .then((summary) => {
        if (cancelled) return;
        setUsdSummary(summary);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUsdInspectorError(
          error instanceof Error
            ? error.message
            : "Failed to summarize USD stage.",
        );
      });

    const inspectPromise = inspectStage(path)
      .then((inspection) => {
        if (cancelled) return;
        setUsdInspection(inspection);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Keep any earlier summarize error; otherwise record this one.
        setUsdInspectorError(
          (previous) =>
            previous ??
            (error instanceof Error
              ? error.message
              : "Failed to inspect USD stage."),
        );
      });

    const issuesPromise = collectAssetIssues(path)
      .then((issues) => {
        if (cancelled) return;
        setUsdIssues(issues);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUsdInspectorError(
          (previous) =>
            previous ??
            (error instanceof Error
              ? error.message
              : "Failed to collect USD asset issues."),
        );
      });

    void Promise.allSettled([
      summarizePromise,
      inspectPromise,
      issuesPromise,
    ]).then(() => {
      if (cancelled) return;
      setUsdInspectorLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [currentFile, isTauri]);

  useEffect(() => {
    setPerformanceSnapshot((previous) => ({
      ...previous,
      startupMs: performance.now() - appStartRef.current,
    }));

    const existingPaintMetric = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");
    if (existingPaintMetric) {
      setPerformanceSnapshot((previous) =>
        previous.firstPaintMs === null
          ? {
              ...previous,
              firstPaintMs: existingPaintMetric.startTime,
            }
          : previous,
      );
    }

    if (typeof PerformanceObserver === "undefined") {
      return;
    }

    const paintObserver = new PerformanceObserver((entryList) => {
      const firstPaint = entryList
        .getEntries()
        .find((entry) => entry.name === "first-contentful-paint");
      if (!firstPaint) {
        return;
      }

      setPerformanceSnapshot((previous) =>
        previous.firstPaintMs === null
          ? {
              ...previous,
              firstPaintMs: firstPaint.startTime,
            }
          : previous,
      );
      paintObserver.disconnect();
    });

    try {
      paintObserver.observe({ type: "paint", buffered: true });
    } catch {
      paintObserver.disconnect();
    }

    return () => {
      paintObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (performanceSnapshot.interactiveMs !== null) {
      return;
    }

    if (!settingsPayload && !settingsError) {
      return;
    }

    let cancelled = false;
    const markInteractive = () => {
      if (cancelled) {
        return;
      }

      setPerformanceSnapshot((previous) =>
        previous.interactiveMs === null
          ? {
              ...previous,
              interactiveMs: performance.now() - appStartRef.current,
            }
          : previous,
      );
    };

    const idleWindow = window as WindowWithIdleCallback;

    if (typeof idleWindow.requestIdleCallback === "function") {
      const callbackId = idleWindow.requestIdleCallback(markInteractive, {
        // Keep this short so the metric still reflects initial usability
        // while allowing the browser to complete immediate startup work.
        timeout: TIME_TO_INTERACTIVE_TIMEOUT_MS,
      });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(callbackId);
      };
    }

    const timeoutId = window.setTimeout(markInteractive, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [performanceSnapshot.interactiveMs, settingsError, settingsPayload]);

  useEffect(() => {
    if (!shouldLoadRecentFiles) {
      return;
    }

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
  }, [currentFile, shouldLoadRecentFiles]);

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
    if (!shouldLoadDeferredData) {
      return;
    }

    void refreshDiagnostics();
  }, [shouldLoadDeferredData]);

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
    if (!shouldLoadDeferredData) {
      return;
    }

    void refreshUpdateConfiguration();
  }, [shouldLoadDeferredData]);

  useEffect(() => {
    if (!shouldLoadDeferredData) {
      return;
    }

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
  }, [
    settingsPayload?.settings.fileAssociationsEnabled,
    shouldLoadDeferredData,
  ]);

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
    // "loading" is a transient state — do not record it as a diagnostic
    // event. Only terminal states (failure / unsupported / missingReference)
    // are worth persisting so the Diagnostics panel stays signal-rich.
    if (
      viewerFeedback.mode === "ready" ||
      viewerFeedback.mode === "empty" ||
      viewerFeedback.mode === "loading"
    ) {
      return;
    }

    const level =
      viewerFeedback.mode === "missingReference" ||
      viewerFeedback.mode === "unsupported"
        ? "warn"
        : "error";

    // Mirror to the webview console so the issue is visible in devtools
    // (Tauri: Ctrl+Shift+I) without having to open the Diagnostics panel.
    const logFn = level === "warn" ? console.warn : console.error;
    logFn(
      `[viewer] ${viewerFeedback.mode}:`,
      viewerFeedback.message,
      viewerFeedback.warning ?? "",
    );

    void (async () => {
      await logDiagnosticEvent({
        code: `VIEWER_${viewerFeedback.mode.toUpperCase()}`,
        level,
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
  const runMenuActionFromNativeMenu = useEffectEvent(
    (actionId: MenuActionId) => {
      void executeMenuAction(actionId);
    },
  );
  const runRecentFileFromNativeMenu = useEffectEvent((path: string) => {
    void handleOpenRecentFile(path);
  });

  type NativeMenuEventPayload =
    | { kind: "action"; actionId: string }
    | { kind: "recentFile"; path: string };

  const isNativeMenuEventPayload = (
    value: unknown,
  ): value is NativeMenuEventPayload => {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const candidate = value as { kind?: unknown };
    if (candidate.kind === "action") {
      return typeof (value as { actionId?: unknown }).actionId === "string";
    }
    if (candidate.kind === "recentFile") {
      return typeof (value as { path?: unknown }).path === "string";
    }
    return false;
  };

  useEffect(() => {
    if (isTauri) {
      return;
    }

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
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let isDisposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<unknown>("yw-look://menu-action", (event) => {
      if (!isNativeMenuEventPayload(event.payload)) {
        return;
      }

      if (event.payload.kind === "action") {
        if (isMenuActionId(event.payload.actionId)) {
          runMenuActionFromNativeMenu(event.payload.actionId);
        }
        return;
      }

      runRecentFileFromNativeMenu(event.payload.path);
    })
      .then((dispose) => {
        if (isDisposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch(() => {
        // Tauri API unavailable (browser dev mode)
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [isTauri]);

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
            {isTauri && isUsdFile(currentFile) && (
              <UsdInspectorCard
                error={usdInspectorError}
                inspection={usdInspection}
                issues={usdIssues}
                loading={usdInspectorLoading}
                summary={usdSummary}
              />
            )}
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
            <Suspense fallback={<SidebarCardFallback />}>
              <SettingsCard
                settingsPayload={settingsPayload}
                settingsError={settingsError}
                onToggleFileAssociations={() =>
                  void handleToggleFileAssociations()
                }
              />
            </Suspense>
            <Suspense fallback={<SidebarCardFallback />}>
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
            </Suspense>
            <Suspense fallback={<SidebarCardFallback />}>
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
            </Suspense>
            <Suspense fallback={<SidebarCardFallback />}>
              <IntegrationCard
                integrationError={integrationError}
                integrationPayload={integrationPayload}
              />
            </Suspense>
          </>
        );
      case "warnings":
        return (
          <>
            <WarningsCard warnings={warnings} />
            <Suspense fallback={<SidebarCardFallback />}>
              <DiagnosticsCard
                diagnosticsError={diagnosticsError}
                diagnosticsPayload={diagnosticsPayload}
              />
            </Suspense>
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
            backgroundPreset={backgroundPreset}
            onFeedbackChange={setViewerFeedback}
            onMetadataChange={setAssetMetadata}
            selectedTextureId={selectedTextureId}
            textureViewMode={textureViewMode}
            viewerSurfaceMode={viewerSurfaceMode}
            textureExposure={textureExposure}
            textureBlackPoint={textureBlackPoint}
            textureWhitePoint={textureWhitePoint}
            textureTileCount={textureTileCount}
            resetVersion={resetVersion}
            showGrid={showGrid}
            showAxes={showAxes}
            showSkeleton={showSkeleton}
            showBoundingBoxes={showBoundingBoxes}
            showNormals={showNormals}
            showVertexColors={showVertexColors}
            showEnvironmentBackground={showEnvironmentBackground}
            environmentRotation={environmentRotation}
            backfaceCulling={backfaceCulling}
            cameraPresetRequest={cameraPresetRequest}
            controlSensitivity={controlSensitivity}
            cameraFov={cameraFov}
            renderScale={renderScale}
            toneMappingMode={toneMappingMode}
            exposure={exposure}
            onGridUnitChange={setGridUnitLabel}
            environmentPreset={environmentPreset}
          />

          {/* ViewModeControls overlay */}
          <div
            className={`view-mode-controls${viewportPanelOpen ? "" : " is-collapsed"}`}
          >
            <button
              className="view-mode-header"
              onClick={() => setViewportPanelOpen((v) => !v)}
              type="button"
              title={viewportPanelOpen ? "Collapse panel" : "Expand panel"}
              aria-expanded={viewportPanelOpen}
            >
              <span className="view-mode-header-label">Viewport</span>
              <span
                className={`view-mode-caret${viewportPanelOpen ? " is-open" : ""}`}
                aria-hidden="true"
              >
                ▾
              </span>
            </button>
            <div className="view-mode-body">
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
            <button
              className={`view-mode-toggle${showAxes ? " is-active" : ""}`}
              onClick={() => setShowAxes((v) => !v)}
              type="button"
              title="Show XYZ axis indicator at the origin"
            >
              <span>Axes</span>
              <span className={`toggle-switch${showAxes ? " is-on" : ""}`} />
            </button>
            <button
              className={`view-mode-toggle${showEnvironmentBackground ? " is-active" : ""}`}
              onClick={() => setShowEnvironmentBackground((v) => !v)}
              type="button"
              title="Show the environment map as the viewport background"
            >
              <span>Env BG</span>
              <span
                className={`toggle-switch${showEnvironmentBackground ? " is-on" : ""}`}
              />
            </button>
            <button
              className={`view-mode-toggle${backfaceCulling ? " is-active" : ""}`}
              onClick={() => setBackfaceCulling((v) => !v)}
              type="button"
              title="Hide polygons facing away from the camera"
            >
              <span>Cull</span>
              <span
                className={`toggle-switch${backfaceCulling ? " is-on" : ""}`}
              />
            </button>
            <button
              className={`view-mode-toggle${showSkeleton ? " is-active" : ""}`}
              onClick={() => setShowSkeleton((v) => !v)}
              type="button"
              title="Show bones of rigged / animated models"
            >
              <span>Skeleton</span>
              <span
                className={`toggle-switch${showSkeleton ? " is-on" : ""}`}
              />
            </button>
            <button
              className={`view-mode-toggle${showBoundingBoxes ? " is-active" : ""}`}
              onClick={() => setShowBoundingBoxes((v) => !v)}
              type="button"
              title="Show per-mesh bounding box outlines"
            >
              <span>BBox</span>
              <span
                className={`toggle-switch${showBoundingBoxes ? " is-on" : ""}`}
              />
            </button>
            <button
              className={`view-mode-toggle${showVertexColors ? " is-active" : ""}`}
              onClick={() => setShowVertexColors((v) => !v)}
              type="button"
              title="Render per-vertex colors when the geometry has a color attribute"
            >
              <span>Vertex Color</span>
              <span
                className={`toggle-switch${showVertexColors ? " is-on" : ""}`}
              />
            </button>
            <button
              className={`view-mode-toggle${showNormals ? " is-active" : ""}`}
              onClick={() => setShowNormals((v) => !v)}
              type="button"
              title="Show vertex normals as line indicators"
            >
              <span>Normals</span>
              <span
                className={`toggle-switch${showNormals ? " is-on" : ""}`}
              />
            </button>
            <div
              aria-label="Background"
              className="view-mode-section"
              role="group"
            >
              <span className="view-mode-section-label">Background</span>
              <div className="preset-chip-row">
                {backgroundPresetOptions.map((option) => (
                  <button
                    key={option.id}
                    aria-pressed={backgroundPreset === option.id}
                    className={`preset-chip${
                      backgroundPreset === option.id ? " is-active" : ""
                    }`}
                    onClick={() => setBackgroundPreset(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="view-mode-section">
              <span className="view-mode-section-label">Environment</span>
              <div className="preset-chip-row">
                {environmentPresets.map((preset) => (
                  <button
                    key={preset.id}
                    className={`preset-chip${environmentPreset === preset.id ? " is-active" : ""}`}
                    onClick={() => setEnvironmentPreset(preset.id)}
                    type="button"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="range-control">
                <span>
                  Rotation {Math.round((environmentRotation * 180) / Math.PI)}°
                </span>
                <input
                  aria-label="Environment map rotation"
                  max={Math.PI * 2}
                  min={0}
                  onChange={(event) =>
                    setEnvironmentRotation(
                      Number.parseFloat(event.target.value),
                    )
                  }
                  onDoubleClick={() => setEnvironmentRotation(0)}
                  step={Math.PI / 180}
                  title="Rotate the environment map around the up axis (double-click to reset)"
                  type="range"
                  value={environmentRotation}
                />
              </label>
            </div>
            <div className="view-mode-section">
              <span className="view-mode-section-label">View</span>
              <div className="preset-chip-row">
                {cameraPresetOptions.map((option) => (
                  <button
                    key={option.id}
                    className="preset-chip"
                    onClick={() =>
                      setCameraPresetRequest((previous) => ({
                        preset: option.id,
                        version: (previous?.version ?? 0) + 1,
                      }))
                    }
                    type="button"
                    title={`View from ${option.label.toLowerCase()}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="range-control">
                <span>Sensitivity {controlSensitivity.toFixed(2)}</span>
                <input
                  aria-label="Camera control sensitivity"
                  max={3}
                  min={0.1}
                  onChange={(event) =>
                    setControlSensitivity(
                      Number.parseFloat(event.target.value),
                    )
                  }
                  onDoubleClick={() => setControlSensitivity(1)}
                  step={0.05}
                  title="Orbit / pan / zoom multiplier (double-click to reset)"
                  type="range"
                  value={controlSensitivity}
                />
              </label>
              <label className="range-control">
                <span>FOV {cameraFov.toFixed(0)}°</span>
                <input
                  aria-label="Camera field of view"
                  max={120}
                  min={10}
                  onChange={(event) =>
                    setCameraFov(Number.parseFloat(event.target.value))
                  }
                  onDoubleClick={() => setCameraFov(45)}
                  step={1}
                  title="Vertical field of view (double-click to reset)"
                  type="range"
                  value={cameraFov}
                />
              </label>
            </div>
            {viewerSurfaceMode === "texture" ? (
              <>
                <div className="view-mode-section">
                  <span className="view-mode-section-label">Channel</span>
                  <div className="preset-chip-row">
                    {textureChannelOptions.map((option) => (
                      <button
                        key={option.id}
                        className={`preset-chip${textureViewMode === option.id ? " is-active" : ""}`}
                        onClick={() => setTextureViewMode(option.id)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="view-mode-section">
                  <span className="view-mode-section-label">Tiling</span>
                  <div className="preset-chip-row">
                    {textureTileOptions.map((option) => (
                      <button
                        key={option.count}
                        className={`preset-chip${textureTileCount === option.count ? " is-active" : ""}`}
                        onClick={() => setTextureTileCount(option.count)}
                        type="button"
                        title={`Repeat the texture ${option.count}x in both directions`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="view-mode-section">
                  <span className="view-mode-section-label">
                    Range (HDR/EXR)
                  </span>
                  <label className="range-control">
                    <span>EV {textureExposure.toFixed(2)}</span>
                    <input
                      aria-label="Texture exposure (EV)"
                      max={6}
                      min={-6}
                      onChange={(event) =>
                        setTextureExposure(
                          Number.parseFloat(event.target.value),
                        )
                      }
                      onDoubleClick={() => setTextureExposure(0)}
                      step={0.1}
                      title="Double-click to reset"
                      type="range"
                      value={textureExposure}
                    />
                  </label>
                  <label className="range-control">
                    <span>Black {textureBlackPoint.toFixed(2)}</span>
                    <input
                      aria-label="Texture black point"
                      max={1}
                      min={-1}
                      onChange={(event) =>
                        setTextureBlackPoint(
                          Number.parseFloat(event.target.value),
                        )
                      }
                      onDoubleClick={() => setTextureBlackPoint(0)}
                      step={0.01}
                      title="Double-click to reset"
                      type="range"
                      value={textureBlackPoint}
                    />
                  </label>
                  <label className="range-control">
                    <span>White {textureWhitePoint.toFixed(2)}</span>
                    <input
                      aria-label="Texture white point"
                      max={8}
                      min={0.1}
                      onChange={(event) =>
                        setTextureWhitePoint(
                          Number.parseFloat(event.target.value),
                        )
                      }
                      onDoubleClick={() => setTextureWhitePoint(1)}
                      step={0.05}
                      title="Double-click to reset"
                      type="range"
                      value={textureWhitePoint}
                    />
                  </label>
                </div>
              </>
            ) : null}
            <div className="view-mode-section">
              <span className="view-mode-section-label">Tone Mapping</span>
              <div className="preset-chip-row">
                {toneMappingOptions.map((option) => (
                  <button
                    key={option.id}
                    className={`preset-chip${toneMappingMode === option.id ? " is-active" : ""}`}
                    onClick={() => setToneMappingMode(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="range-control">
                <span>Exposure {exposure.toFixed(2)}</span>
                <input
                  aria-label="Exposure"
                  max={4}
                  min={0}
                  onChange={(event) =>
                    setExposure(Number.parseFloat(event.target.value))
                  }
                  onDoubleClick={() => setExposure(DEFAULT_EXPOSURE)}
                  step={0.05}
                  title="Double-click to reset"
                  type="range"
                  value={exposure}
                />
              </label>
            </div>
            <div className="view-mode-section">
              <span className="view-mode-section-label">Quality</span>
              <div className="preset-chip-row">
                {renderScaleOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`preset-chip${renderScale === option.value ? " is-active" : ""}`}
                    onClick={() => setRenderScale(option.value)}
                    type="button"
                    title={`Render at ${option.label} of the device pixel ratio`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            </div>
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
