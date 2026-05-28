import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
/* eslint-disable react-hooks/set-state-in-effect -- existing effect patterns intentionally reset state synchronously */
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
  type TextureFilterMode,
  type TextureViewMode,
  type ToneMappingMode,
  type ViewerFeedback,
  type ViewerSurfaceMode,
} from "./components/AssetViewport";
import {
  emptyAssetMetadata,
  type AssetMetadata,
} from "./components/assetMetadata";
import { AppStatusBar } from "./components/AppStatusBar";
import {
  buildStatusLeftItems,
  buildStatusRightItems,
} from "./components/appStatusItems";
import { CurrentFileCard } from "./components/CurrentFileCard";
import { ObjectInspectorCard } from "./components/ObjectInspectorCard";
import {
  debugPanelDirectoryListing,
  debugPanelFile,
  debugPanelMetadata,
  debugPanelRecentFiles,
  debugPanelWarnings,
  debugUsdInspection,
  debugUsdSummary,
} from "./components/debugPanelFixtures";
import { FileBrowserCard } from "./components/FileBrowserCard";
import { HierarchyCard } from "./components/HierarchyCard";
import { UsdPrimPropertyPanel } from "./components/UsdPrimPropertyPanel";
import { MaterialListCard } from "./components/MaterialListCard";
import { MmdMetadataCard } from "./components/MmdMetadataCard";
import { PerformanceCard } from "./components/PerformanceCard";
import { SceneLightsCamerasCard } from "./components/SceneLightsCamerasCard";
import { SidebarTabs } from "./components/SidebarTabs";
import { createSidebarTabs } from "./components/sidebarTabItems";
import { SidebarEmpty, SidebarSection } from "./components/sidebarPrimitives";
import type { SidebarTabId } from "./components/SidebarTabIcons";
import { TextureListCard } from "./components/TextureListCard";
import { UsdInspectorCard } from "./components/UsdInspectorCard";
import { ViewportControls } from "./components/ViewportControls";
import { build3DToolbar } from "./components/toolbar/build3DToolbar";
import {
  buildImageToolbar,
  type TextureColorSpace,
} from "./components/toolbar/buildImageToolbar";
import type { ToolbarItem } from "./components/toolbar/types";
import { WarningsCard } from "./components/WarningsCard";
import {
  formatUsdErrorForDisplay,
  isInvalidVariantSelectionError,
  parseUsdError,
  type AssetIssue,
  type PurposeModes,
  type StageLoadPolicy,
  type VariantSelection,
} from "./lib/usd";
import { type ResourceDiagnosticsSnapshot } from "./lib/diagnostics";
import {
  getStartupFile,
  inspectAsset,
  listSupportedSiblings,
  openFileDialog,
  resolveSelectedFile,
  type AssetInspection,
  type DirectoryListing,
  type SelectedFile,
} from "./lib/files";
import { prefetchAdjacent } from "./viewer";
import { isTauriEnvironment } from "./lib/platform";
import { formatShortcut, menuShortcuts, type MenuActionId } from "./lib/menu";
import {
  applyViewerShortcutAction,
  viewerShortcutHelpLines,
  type ViewportShortcutCommand,
  type ViewerShortcutAction,
} from "./lib/viewerShortcuts";
import { saveSettings } from "./lib/settings";
import { usePerformanceTracker } from "./hooks/usePerformanceTracker";
import { useUpdater } from "./hooks/useUpdater";
import { useUsdInspector } from "./hooks/useUsdInspector";
import { usePayloadSession } from "./hooks/usePayloadSession";
import { useDeferredData } from "./hooks/useDeferredData";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

type SidebarTab = SidebarTabId;

const USD_EXTENSIONS = new Set(["usd", "usda", "usdc", "usdz"]);
const MMD_MODEL_EXTENSIONS = new Set(["pmx", "pmd"]);

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function isUsdFile(file: SelectedFile | null): boolean {
  return !!file && USD_EXTENSIONS.has(file.extension);
}

function extensionFromPath(path: string) {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
}

function selectedMotionFileFromPath(path: string): SelectedFile {
  const parts = path.split(/[\\/]/);
  const fileName = parts.pop() || path;
  const parentDirectory = parts.join("\\");
  return {
    path,
    fileName,
    extension: extensionFromPath(path),
    kind: "motion",
    parentDirectory,
  };
}

function canAttachMmdMotion(file: SelectedFile | null) {
  return file !== null && MMD_MODEL_EXTENSIONS.has(file.extension);
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

function formatMmdDiagnostic(
  diagnostic: NonNullable<AssetMetadata["mmd"]>["diagnostics"][number],
): string {
  const prefix = diagnostic.level === "error" ? "MMD error" : "MMD warning";
  return `${prefix}: ${diagnostic.message} (${diagnostic.code})`;
}

function splitViewerWarnings(warning: string | null): string[] {
  return (
    warning
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean) ?? []
  );
}

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

const environmentPresets: Array<{
  id: EnvironmentPreset;
  label: string;
}> = [
  { id: "studio", label: "Studio" },
  { id: "neutral", label: "Neutral" },
  { id: "outdoor", label: "Outdoor" },
];

const CompositionArcsCard = lazy(() =>
  import("./components/CompositionArcsCard").then((module) => ({
    default: module.CompositionArcsCard,
  })),
);
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
const UsdSourceCard = lazy(() =>
  import("./components/UsdSourceCard").then((module) => ({
    default: module.UsdSourceCard,
  })),
);

function SidebarCardFallback() {
  return (
    <SidebarSection title="Loading">
      <SidebarEmpty>Loading panel…</SidebarEmpty>
    </SidebarSection>
  );
}

function isDebugPanelsRequested(): boolean {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("debugPanels") === "1" || params.get("uiDebug") === "panels"
  );
}

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

const DEFAULT_EXPOSURE = 1.1;

export function App() {
  const [activeTab, setActiveTab] = useState<SidebarTab>("properties");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.innerWidth >= 720,
  );
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const [showTexture, setShowTexture] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showUnlit, setShowUnlit] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showAxes, setShowAxes] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(false);
  const [showNormals, setShowNormals] = useState(false);
  const [showVertexColors, setShowVertexColors] = useState(false);
  const [viewportPanelOpen, setViewportPanelOpen] = useState(true);
  const [showEnvironmentBackground, setShowEnvironmentBackground] =
    useState(false);
  const [environmentRotation] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [backfaceCulling, setBackfaceCulling] = useState(true);
  const [textureFilterMode] = useState<TextureFilterMode>("trilinear");
  const [cameraPresetRequest, setCameraPresetRequest] =
    useState<CameraPresetRequest | null>(null);
  const [controlSensitivity] = useState(1);
  const [cameraFov] = useState(45);
  const [renderScale] = useState(1);
  const [showShadows, setShowShadows] = useState(false);
  const [fxaaEnabled] = useState(false);
  const [showRendererStats] = useState(false);
  const [toneMappingMode] = useState<ToneMappingMode>("aces");
  const [exposure] = useState(DEFAULT_EXPOSURE);
  const [cameraSpeedMultiplier] = useState(1);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [backgroundPreset, setBackgroundPreset] =
    useState<BackgroundPreset>("gray");
  const [environmentPreset, setEnvironmentPreset] =
    useState<EnvironmentPreset>("studio");
  const [gridUnitLabel, setGridUnitLabel] = useState("1 m");
  const [currentFile, setCurrentFile] = useState<SelectedFile | null>(null);
  const [mmdMotionRequest, setMmdMotionRequest] = useState<{
    file: SelectedFile;
    version: number;
  } | null>(null);
  const [assetInspection, setAssetInspection] =
    useState<AssetInspection | null>(null);
  const [directoryListing, setDirectoryListing] =
    useState<DirectoryListing | null>(null);
  const [viewerFeedback, setViewerFeedback] = useState<ViewerFeedback>(
    initialViewerFeedback,
  );
  const displayMode = deriveDisplayMode(showTexture, showWireframe);
  const [openError, setOpenError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [scaleNormalization, setScaleNormalization] = useState<{
    applied: boolean;
    factor: number;
  } | null>(null);
  const [cancelScaleNormalizeVersion, setCancelScaleNormalizeVersion] =
    useState(0);
  const [viewportShortcutCommand, setViewportShortcutCommand] =
    useState<ViewportShortcutCommand | null>(null);
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
  const [textureColorSpace, setTextureColorSpace] =
    useState<TextureColorSpace>("srgb");
  const [textureExposure] = useState(0);
  const [textureBlackPoint] = useState(0);
  const [textureWhitePoint] = useState(1);
  const [textureTileCount] = useState(1);
  const [textureGamma, setTextureGamma] = useState(2.2);
  // Default = flat 2D viewer framing for textures. The 3D toggle
  // re-uses the asset orbit controls so the same texture plane can
  // be rotated/zoomed as a 3D quad — useful for inspecting how a
  // texture behaves at glancing angles or with the env reflection.
  const [texturePreview3D] = useState(false);
  const [resourceDiagnostics, setResourceDiagnostics] =
    useState<ResourceDiagnosticsSnapshot | null>(null);
  const [dialogState, setDialogState] = useState<{
    title: string;
    lines: string[];
  } | null>(null);
  // Phase 4: deferred-payload toggle. Default to `loadAll` so payload-only
  // component roots open with visible geometry; switching to `noPayloads`
  // re-runs the inspector and GLB pipeline with payloads deferred.
  const [usdLoadPolicy, setUsdLoadPolicy] =
    useState<StageLoadPolicy>("loadAll");
  // #33/#46: unified selection key — viewport pick or hierarchy row click.
  // For USD assets that went through the hierarchy-aware GLB pipeline
  // (#46) the value is a USD SdfPath (e.g. "/World/Cube") surfaced from
  // userData.primPath; for non-USD / legacy assets it remains the
  // Three.js Object3D.name.  Both HierarchyCard and the viewport tint
  // path match on this same key, so the two directions stay in sync.
  const [selectedMeshName, setSelectedMeshName] = useState<string | null>(null);
  const [morphTargetValues, setMorphTargetValues] = useState<
    Record<string, Record<number, number>>
  >({});
  // #28: USD prim path selected in the hierarchy tree.
  // Drives the UsdPrimPropertyPanel. Separate from `selectedMeshName`
  // because the hierarchy tree can select any prim (not just meshes).
  const [selectedUsdPrimPath, setSelectedUsdPrimPath] = useState<string | null>(
    null,
  );
  // #32: USD purpose visibility. Defaults match pre-#32 behavior:
  // render ON, proxy/guide OFF.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [purposeModes, setPurposeModes] = useState<PurposeModes>({
    render: true,
    proxy: false,
    guide: false,
  });
  // #34: active USD camera id (Three.js uuid). null = free orbit. Using
  // the uuid rather than the authored name keeps duplicate / unnamed
  // cameras independently selectable.
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  // #31: variant selections applied before geometry extraction.
  // Populated by the UsdInspectorCard switcher pulldown.
  const [variantSelections, setVariantSelections] = useState<
    VariantSelection[]
  >([]);
  const [variantSelectionError, setVariantSelectionError] = useState<
    string | null
  >(null);

  const isTauri = isTauriEnvironment();
  const debugPanelsEnabled = !isTauri && isDebugPanelsRequested();
  const sidebarCurrentFile = debugPanelsEnabled ? debugPanelFile : currentFile;
  const sidebarAssetMetadata = debugPanelsEnabled
    ? debugPanelMetadata
    : assetMetadata;
  const sidebarDirectoryListing = debugPanelsEnabled
    ? debugPanelDirectoryListing
    : directoryListing;
  const recordVariantSelectionError = useCallback((error: unknown): boolean => {
    const parsed = parseUsdError(error);
    if (!isInvalidVariantSelectionError(parsed)) {
      return false;
    }

    const message = formatUsdErrorForDisplay(
      error,
      "Variant selection failed.",
    );
    console.error("[usd] variant selection failed:", error);
    setVariantSelectionError(message);
    return true;
  }, []);
  const handleMorphTargetChange = useCallback(
    (selectionKey: string, morphTargetIndex: number, value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      setMorphTargetValues((previous) => ({
        ...previous,
        [selectionKey]: {
          ...(previous[selectionKey] ?? {}),
          [morphTargetIndex]: clamped,
        },
      }));
    },
    [],
  );

  useEffect(() => {
    setMorphTargetValues({});
  }, [currentFile?.path]);

  const applyVariantSelection = useCallback(
    (primPath: string, setName: string, variantName: string) => {
      setVariantSelectionError(null);
      setVariantSelections((prev) => {
        const next = prev.filter(
          (s) => !(s.primPath === primPath && s.setName === setName),
        );
        next.push({ primPath, setName, variantName });
        return next;
      });
    },
    [],
  );
  const shouldLoadRecentFiles = sidebarOpen;
  const shouldLoadDeferredData = sidebarOpen;

  const viewerStatusLabel = useMemo(() => {
    switch (viewerFeedback.mode) {
      case "loading":
        return "loading preview";
      case "ready":
        return "preview ready";
      case "unsupported":
        return "unsupported format";
      case "missingOptionalLoader":
        return "optional loader missing";
      case "loadFailed":
        return "preview failed";
      case "missingReference":
        return "missing external resource";
      default:
        return "idle";
    }
  }, [viewerFeedback.mode]);

  const currentFileSummary = useMemo(() => {
    if (!sidebarCurrentFile) {
      return "none";
    }

    if (
      sidebarDirectoryListing?.currentIndex !== null &&
      sidebarDirectoryListing?.files.length
    ) {
      return `${sidebarCurrentFile.fileName} (${sidebarDirectoryListing.currentIndex + 1}/${sidebarDirectoryListing.files.length})`;
    }

    return `${sidebarCurrentFile.fileName} (${sidebarCurrentFile.kind})`;
  }, [sidebarDirectoryListing, sidebarCurrentFile]);

  const canNavigatePrev =
    directoryListing !== null &&
    directoryListing.currentIndex !== null &&
    directoryListing.currentIndex > 0 &&
    directoryListing.files.length > 0;
  const canNavigateNext =
    directoryListing !== null &&
    directoryListing.currentIndex !== null &&
    directoryListing.currentIndex < directoryListing.files.length - 1;
  const viewerWarningLines = useMemo(
    () => splitViewerWarnings(viewerFeedback.warning),
    [viewerFeedback.warning],
  );
  const {
    usdSummary,
    usdInspection,
    usdIssues,
    usdLights,
    usdInspectorLoading,
    usdInspectorError,
  } = useUsdInspector(currentFile, isTauri, usdLoadPolicy);

  const warnings = useMemo(() => {
    const nextWarnings: string[] = [];

    nextWarnings.push(...viewerWarningLines);

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

    for (const diagnostic of assetMetadata?.mmd?.diagnostics ?? []) {
      nextWarnings.push(formatMmdDiagnostic(diagnostic));
    }

    return nextWarnings;
  }, [
    assetMetadata?.mmd?.diagnostics,
    assetMetadata?.textures,
    usdIssues,
    viewerWarningLines,
  ]);
  const sidebarWarnings = debugPanelsEnabled ? debugPanelWarnings : warnings;
  const diagnosticCounts = useMemo(() => {
    if (debugPanelsEnabled) {
      return {
        errorCount: 0,
        warningCount: debugPanelWarnings.length,
        total: debugPanelWarnings.length,
      };
    }

    const loadErrorCount =
      viewerFeedback.mode === "loadFailed" ||
      viewerFeedback.mode === "missingReference"
        ? 1
        : 0;
    const usdErrorCount = usdIssues.filter(
      (issue) => issue.level === "error",
    ).length;
    const usdWarningCount = usdIssues.filter(
      (issue) => issue.level === "warning",
    ).length;
    const unresolvedTextureCount =
      assetMetadata?.textures.filter(
        (texture) => texture.sourceKind === "unresolved",
      ).length ?? 0;
    const viewerWarningCount = viewerWarningLines.length;
    const mmdErrorCount =
      assetMetadata?.mmd?.diagnostics.filter(
        (diagnostic) => diagnostic.level === "error",
      ).length ?? 0;
    const mmdWarningCount =
      assetMetadata?.mmd?.diagnostics.filter(
        (diagnostic) => diagnostic.level === "warning",
      ).length ?? 0;
    const errorCount = loadErrorCount + usdErrorCount + mmdErrorCount;
    const warningCount =
      usdWarningCount +
      unresolvedTextureCount +
      viewerWarningCount +
      mmdWarningCount;

    return {
      errorCount,
      warningCount,
      total: errorCount + warningCount,
    };
  }, [
    assetMetadata?.mmd?.diagnostics,
    assetMetadata?.textures,
    debugPanelsEnabled,
    usdIssues,
    viewerWarningLines,
    viewerFeedback.mode,
  ]);
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

  const {
    stageSessionHandle,
    payloadPrimPaths,
    unloadedPayloadPaths,
    sessionGlbBuffer,
    setSessionGlbBuffer,
    handleLoadPayload,
    handleUnloadPayload,
  } = usePayloadSession(
    currentFile,
    isTauri,
    usdLoadPolicy,
    usdInspection,
    variantSelections,
    purposeModes,
    recordVariantSelectionError,
  );

  useEffect(() => {
    setVariantSelections([]);
    setVariantSelectionError(null);
    setSessionGlbBuffer(null);
  }, [currentFile, usdLoadPolicy, setSessionGlbBuffer]);

  const {
    settingsPayload,
    settingsError,
    setSettingsPayload,
    setSettingsError,
    recentFilesPayload,
    recentFilesError,
    setRecentFilesError,
    diagnosticsPayload,
    diagnosticsError,
    processMemoryMetrics,
    integrationPayload,
    integrationError,
    logDiagnosticEventAndRefresh,
  } = useDeferredData(
    isTauri,
    shouldLoadRecentFiles,
    shouldLoadDeferredData,
    currentFile,
    resourceDiagnostics,
  );

  const sidebarRecentFilesPayload = debugPanelsEnabled
    ? debugPanelRecentFiles
    : recentFilesPayload;
  const sidebarRecentFilesError = debugPanelsEnabled ? null : recentFilesError;

  const {
    updateConfiguration,
    updateCheck,
    updateError,
    isCheckingForUpdate,
    isInstallingUpdate,
    setUpdateError,
    refreshUpdateConfiguration,
    handleCheckForUpdate,
    handleInstallUpdate,
  } = useUpdater(shouldLoadDeferredData, settingsPayload);

  const { performanceSnapshot, recordLoadTiming } = usePerformanceTracker(
    settingsPayload,
    settingsError,
  );

  useEffect(() => {
    // #33: a fresh file invalidates the prior viewport pick. The
    // selection refers to a Three.js Object3D.name, and the next
    // asset's hierarchy will not contain the same node.
    setSelectedMeshName(null);
    // #28: also clear the USD prim path selection so the property
    // panel does not query the new file with the old prim path.
    setSelectedUsdPrimPath(null);
    // #34: reset active camera to free orbit when a new file is opened so
    // the camera list in the new asset does not inherit a stale override.
    setActiveCameraId(null);
  }, [currentFile?.path]);

  useEffect(() => {
    if (!isTauri || !currentFile) {
      setAssetInspection(null);
      return;
    }

    let isActive = true;
    setAssetInspection(null);
    void inspectAsset(currentFile.path)
      .then((inspection) => {
        if (isActive) {
          setAssetInspection(inspection);
        }
      })
      .catch((error: unknown) => {
        console.warn("[file] inspect_asset failed:", error);
      });

    return () => {
      isActive = false;
    };
  }, [currentFile, isTauri]);

  useEffect(() => {
    if (!currentFile) {
      if (selectedTextureId !== null) {
        setSelectedTextureId(null);
      }
      if (viewerSurfaceMode !== "asset") {
        setViewerSurfaceMode("asset");
      }
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
      await logDiagnosticEventAndRefresh({
        code: "APP_OPEN_ERROR",
        level: "error",
        message: openError,
        contextPath: currentFile?.path ?? null,
      });
    })();
  }, [currentFile?.path, openError, logDiagnosticEventAndRefresh]);

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
      viewerFeedback.mode === "unsupported" ||
      viewerFeedback.mode === "missingOptionalLoader"
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
      await logDiagnosticEventAndRefresh({
        code: `VIEWER_${viewerFeedback.mode.toUpperCase()}`,
        level,
        message: viewerFeedback.message,
        detail: viewerFeedback.warning,
        contextPath: currentFile?.path ?? null,
      });
    })();
  }, [
    currentFile?.path,
    viewerFeedback.message,
    viewerFeedback.mode,
    viewerFeedback.warning,
    logDiagnosticEventAndRefresh,
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
    setMmdMotionRequest(null);
    setDirectoryListing(listing);
    prefetchAdjacent(listing.files, listing.currentIndex);
    recordLoadTiming(startedAt, reason);
  };

  const selectFilePathFromEffect = useEffectEvent(
    async (
      path: string,
      reason: "open" | "startup" | "navigation" | "retry" | "recent" = "open",
    ) => {
      await performSelectFilePath(path, reason);
    },
  );

  const handleDroppedFilePathFromEffect = useEffectEvent(
    async (path: string) => {
      if (extensionFromPath(path) === "vmd") {
        if (!canAttachMmdMotion(currentFile)) {
          setViewerFeedback((previous) => ({
            ...previous,
            mode: previous.mode === "empty" ? "empty" : "loadFailed",
            message: "VMD motion was not loaded.",
            warning:
              "Drop a VMD file after opening a PMX or PMD model to attach it as motion.",
          }));
          return;
        }

        setMmdMotionRequest((previous) => ({
          file: selectedMotionFileFromPath(path),
          version: (previous?.version ?? 0) + 1,
        }));
        return;
      }

      await performSelectFilePath(path, "open");
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
    if (!isTauri) {
      return;
    }

    let isDisposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<string>("yw-look://open-file", (event) => {
      const path = event.payload;
      if (!path) {
        return;
      }
      void selectFilePathFromEffect(path, "startup");
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

          handleDroppedFilePathFromEffect(firstPath).catch((error: unknown) => {
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

  const executeViewerShortcutAction = (action: ViewerShortcutAction) => {
    if (
      action === "focusSelected" ||
      action === "frameAll" ||
      action === "resetView"
    ) {
      setActiveCameraId(null);
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

    if (nextState.showTexture !== showTexture) {
      setShowTexture(nextState.showTexture);
    }
    if (nextState.showWireframe !== showWireframe) {
      setShowWireframe(nextState.showWireframe);
    }
    if (nextState.showGrid !== showGrid) {
      setShowGrid(nextState.showGrid);
    }
    if (nextState.selectedMeshName !== selectedMeshName) {
      setSelectedMeshName(nextState.selectedMeshName);
    }
    if (nextState.selectedUsdPrimPath !== selectedUsdPrimPath) {
      setSelectedUsdPrimPath(nextState.selectedUsdPrimPath);
    }
    if (nextState.viewportCommand !== viewportShortcutCommand) {
      setViewportShortcutCommand(nextState.viewportCommand);
    }
  };

  const handleNavigateError = useCallback((error: unknown) => {
    setOpenError(
      error instanceof Error ? error.message : "Failed to navigate to file.",
    );
  }, []);

  useKeyboardShortcuts(
    canNavigatePrev,
    canNavigateNext,
    directoryListing,
    handleNavigateError,
    performSelectFilePath,
    executeViewerShortcutAction,
    executeMenuAction,
  );

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

  const handleToggleAutoCheckForUpdates = async () => {
    if (!settingsPayload) {
      return;
    }

    try {
      const nextPayload = await saveSettings({
        ...settingsPayload.settings,
        autoCheckForUpdates: !settingsPayload.settings.autoCheckForUpdates,
      });
      setSettingsPayload(nextPayload);
      setSettingsError(null);
    } catch (error: unknown) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Failed to update auto-update setting.",
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
      setUpdateError(errorMessage(error, "Failed to save updater settings."));
    }
  };

  const sidebarContent = (() => {
    switch (activeTab) {
      case "properties":
        return (
          <>
            <CurrentFileCard
              assetInspection={assetInspection}
              currentFile={sidebarCurrentFile}
              metadata={sidebarAssetMetadata}
              performanceSnapshot={performanceSnapshot}
              usdPayloadSummary={
                debugPanelsEnabled ? debugUsdSummary : usdSummary
              }
              warnings={sidebarWarnings}
            />
            {sidebarAssetMetadata?.mmd ? (
              <MmdMetadataCard metadata={sidebarAssetMetadata.mmd} />
            ) : null}
            {isTauri && isUsdFile(currentFile) && (
              <>
                <UsdInspectorCard
                  error={usdInspectorError}
                  inspection={usdInspection}
                  issues={usdIssues}
                  loading={usdInspectorLoading}
                  summary={usdSummary}
                  loadPolicy={usdLoadPolicy}
                  onLoadPolicyChange={setUsdLoadPolicy}
                  variantSelectionError={variantSelectionError}
                  variantSelections={variantSelections}
                  onVariantChange={applyVariantSelection}
                />
                <Suspense fallback={<SidebarCardFallback />}>
                  <CompositionArcsCard
                    inspection={usdInspection}
                    loading={usdInspectorLoading}
                  />
                </Suspense>
                <Suspense fallback={<SidebarCardFallback />}>
                  <UsdSourceCard currentFile={currentFile} />
                </Suspense>
              </>
            )}
            {debugPanelsEnabled && (
              <UsdInspectorCard
                error={null}
                inspection={debugUsdInspection}
                issues={[]}
                loading={false}
                summary={debugUsdSummary}
                loadPolicy={usdLoadPolicy}
                onLoadPolicyChange={setUsdLoadPolicy}
                variantSelectionError={variantSelectionError}
                variantSelections={variantSelections}
                onVariantChange={applyVariantSelection}
              />
            )}
            {sidebarAssetMetadata && (
              <SceneLightsCamerasCard
                lights={sidebarAssetMetadata.lights}
                cameras={sidebarAssetMetadata.cameras}
                usdLights={usdLights ?? undefined}
                activeCameraId={activeCameraId}
                onSelectCamera={setActiveCameraId}
              />
            )}
            <PerformanceCard snapshot={performanceSnapshot} />
          </>
        );
      case "file":
        return (
          <>
            <FileBrowserCard
              currentFile={sidebarCurrentFile}
              directoryListing={sidebarDirectoryListing}
              onOpenPath={(path) => {
                void performSelectFilePath(path, "navigation").catch(
                  (error: unknown) => {
                    setRecentFilesError(
                      error instanceof Error
                        ? error.message
                        : "Failed to open file.",
                    );
                  },
                );
              }}
            />
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
                recentFilesError={sidebarRecentFilesError}
                recentFilesPayload={sidebarRecentFilesPayload}
              />
            </Suspense>
          </>
        );
      case "hierarchy":
        return (
          <>
            <HierarchyCard
              hierarchy={sidebarAssetMetadata?.hierarchy ?? []}
              objectInfo={sidebarAssetMetadata?.objectInfo}
              morphTargetValues={morphTargetValues}
              onMorphTargetChange={handleMorphTargetChange}
              selectedName={selectedMeshName}
              onSelectName={setSelectedMeshName}
              onSelectPrimPath={
                isUsdFile(currentFile)
                  ? (primPath) => setSelectedUsdPrimPath(primPath)
                  : undefined
              }
              payloadPrimPaths={
                stageSessionHandle !== null ? payloadPrimPaths : undefined
              }
              unloadedPayloadPaths={
                stageSessionHandle !== null ? unloadedPayloadPaths : undefined
              }
              onLoadPayload={
                stageSessionHandle !== null ? handleLoadPayload : undefined
              }
              onUnloadPayload={
                stageSessionHandle !== null ? handleUnloadPayload : undefined
              }
            />
            {sidebarAssetMetadata && selectedMeshName ? (
              <ObjectInspectorCard
                selectedKey={selectedMeshName}
                objectInfo={
                  sidebarAssetMetadata.objectInfo[selectedMeshName] ?? null
                }
                metadata={sidebarAssetMetadata}
              />
            ) : null}
            {isUsdFile(currentFile) && (
              <UsdPrimPropertyPanel
                path={currentFile?.path ?? null}
                selectedPrimPath={selectedUsdPrimPath}
              />
            )}
          </>
        );
      case "materials":
        return (
          <MaterialListCard materials={sidebarAssetMetadata?.materials ?? []} />
        );
      case "textures":
        return (
          <TextureListCard
            activeTextureId={
              selectedTextureId ?? sidebarAssetMetadata?.textures[0]?.id ?? null
            }
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
            textures={sidebarAssetMetadata?.textures ?? []}
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
                onToggleAutoCheckForUpdates={() =>
                  void handleToggleAutoCheckForUpdates()
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
            <WarningsCard warnings={sidebarWarnings} />
            <Suspense fallback={<SidebarCardFallback />}>
              <DiagnosticsCard
                diagnosticsError={diagnosticsError}
                diagnosticsPayload={diagnosticsPayload}
                processMemoryMetrics={processMemoryMetrics}
                resourceDiagnostics={resourceDiagnostics}
              />
            </Suspense>
          </>
        );
    }
  })();

  const sidebarTabs = useMemo(
    () =>
      createSidebarTabs().map((tab) =>
        tab.id === "warnings" && diagnosticCounts.total > 0
          ? {
              ...tab,
              badge: {
                count: diagnosticCounts.total,
                tone:
                  diagnosticCounts.errorCount > 0
                    ? ("danger" as const)
                    : ("warning" as const),
              },
            }
          : tab,
      ),
    [diagnosticCounts.errorCount, diagnosticCounts.total],
  );

  const openDiagnosticsPanel = useCallback(() => {
    setSidebarOpen(true);
    setActiveTab("warnings");
  }, []);

  const openUpdatePanel = useCallback(() => {
    setSidebarOpen(true);
    setActiveTab("settings");
    void refreshUpdateConfiguration();
  }, [refreshUpdateConfiguration]);

  const statusLeftItems = useMemo(() => {
    const items = buildStatusLeftItems({
      assetMetadata: sidebarAssetMetadata,
      currentFile: sidebarCurrentFile,
      gridUnitLabel,
      settingsError,
      showGrid,
      viewerFeedback,
      viewerStatusLabel,
    });

    if (diagnosticCounts.total > 0) {
      const label =
        diagnosticCounts.errorCount > 0
          ? `${diagnosticCounts.errorCount} error${diagnosticCounts.errorCount === 1 ? "" : "s"}`
          : `${diagnosticCounts.warningCount} warning${diagnosticCounts.warningCount === 1 ? "" : "s"}`;
      items.push({
        id: "diagnostics",
        content: `Diagnostics: ${label}`,
        onClick: openDiagnosticsPanel,
        tone: diagnosticCounts.errorCount > 0 ? "danger" : "warning",
      });
    }

    return items;
  }, [
    diagnosticCounts.errorCount,
    diagnosticCounts.total,
    diagnosticCounts.warningCount,
    gridUnitLabel,
    openDiagnosticsPanel,
    sidebarAssetMetadata,
    sidebarCurrentFile,
    settingsError,
    showGrid,
    viewerFeedback,
    viewerStatusLabel,
  ]);

  const statusRightItems = useMemo(() => {
    const items = buildStatusRightItems({
      currentFileSummary,
      performanceSnapshot,
    });

    if (updateCheck?.update) {
      items.unshift({
        id: "update-available",
        content: `Update: ${updateCheck.update.version}`,
        onClick: openUpdatePanel,
        tone: "warning",
      });
    }

    return items;
  }, [currentFileSummary, openUpdatePanel, performanceSnapshot, updateCheck]);

  const handleSidebarResizeStart = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const minWidth = 300;
    const maxWidth = Math.min(560, Math.floor(window.innerWidth * 0.48));

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + (startX - moveEvent.clientX);
      setSidebarWidth(Math.min(maxWidth, Math.max(minWidth, nextWidth)));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.classList.remove("is-resizing-sidebar");
    };

    document.body.classList.add("is-resizing-sidebar");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleSelectCameraPreset = useCallback((preset: string) => {
    setCameraPresetRequest((previous) => ({
      preset: preset as CameraPreset,
      version: (previous?.version ?? 0) + 1,
    }));
  }, []);

  const handleSelectEnvironmentPreset = useCallback((preset: string) => {
    setEnvironmentPreset(preset as EnvironmentPreset);
  }, []);

  // Cycle camera presets on toolbar click
  const handleCycleCamera = useCallback(() => {
    if (cameraPresetOptions.length === 0) return;
    const currentIdx = cameraPresetOptions.findIndex(
      (p) => p.id === cameraPresetRequest?.preset,
    );
    const nextIdx = (currentIdx + 1) % cameraPresetOptions.length;
    setCameraPresetRequest({
      preset: cameraPresetOptions[nextIdx].id,
      version: (cameraPresetRequest?.version ?? 0) + 1,
    });
  }, [cameraPresetRequest]);

  // Image mode handlers
  const channelOptions = useMemo(
    () => [
      { id: "rgb", label: "RGB" },
      { id: "r", label: "R" },
      { id: "g", label: "G" },
      { id: "b", label: "B" },
      { id: "a", label: "A" },
    ],
    [],
  );

  const handleSelectChannel = useCallback((mode: string) => {
    if (mode === "a") {
      setTextureViewMode("alpha");
    } else {
      setTextureViewMode(mode as TextureViewMode);
    }
  }, []);

  const handleSelectColorSpace = useCallback((mode: TextureColorSpace) => {
    setTextureColorSpace(mode);
    switch (mode) {
      case "srgb":
        setTextureGamma(2.2);
        break;
      case "linear":
        setTextureGamma(1.0);
        break;
      case "raw":
        setTextureGamma(1.0);
        break;
    }
  }, []);

  const viewportToolbarItems = useMemo<ToolbarItem[]>(() => {
    if (viewerSurfaceMode === "texture") {
      return buildImageToolbar({
        channelMode: textureViewMode,
        channelOptions,
        onSelectChannel: handleSelectChannel,
        colorSpace: textureColorSpace,
        onSelectColorSpace: handleSelectColorSpace,
        exposure: textureExposure,
        bgMode: "checker",
        tilingMode: "clamp",
        tileCount: textureTileCount,
      });
    }

    return build3DToolbar({
      // Camera
      cameraPreset: cameraPresetRequest?.preset ?? null,
      cameraPresetOptions,
      onSelectCameraPreset: handleSelectCameraPreset,
      onCycleCamera: handleCycleCamera,
      // Shading
      showTexture,
      onToggleTexture: () => setShowTexture((v) => !v),
      showUnlit,
      onToggleUnlit: () => setShowUnlit((v) => !v),
      showNormals,
      onToggleNormals: () => setShowNormals((v) => !v),
      showVertexColors,
      onToggleVertexColors: () => setShowVertexColors((v) => !v),
      // Wireframe
      showWireframe,
      onToggleWireframe: () => setShowWireframe((v) => !v),
      // Look
      environmentPreset,
      environmentPresetOptions: environmentPresets,
      onSelectEnvironmentPreset: handleSelectEnvironmentPreset,
      showShadows,
      onToggleShadows: () => setShowShadows((v) => !v),
      showEnvironmentBackground,
      onToggleEnvironmentBackground: () =>
        setShowEnvironmentBackground((v) => !v),
      // Overlay
      showBoundingBoxes,
      onToggleBoundingBoxes: () => setShowBoundingBoxes((v) => !v),
      showSkeleton,
      onToggleSkeleton: () => setShowSkeleton((v) => !v),
    });
  }, [
    cameraPresetRequest,
    handleSelectCameraPreset,
    handleCycleCamera,
    showTexture,
    showUnlit,
    showNormals,
    showVertexColors,
    showWireframe,
    environmentPreset,
    handleSelectEnvironmentPreset,
    showShadows,
    showEnvironmentBackground,
    showBoundingBoxes,
    showSkeleton,
    viewerSurfaceMode,
    textureViewMode,
    channelOptions,
    handleSelectChannel,
    textureColorSpace,
    handleSelectColorSpace,
    textureExposure,
    textureTileCount,
  ]);

  return (
    <main className="app-shell">
      {/* ── Viewport ── */}
      <section className="main-content">
        <div className="viewer-panel">
          <AssetViewport
            currentFile={currentFile}
            mmdMotionRequest={mmdMotionRequest}
            displayMode={displayMode}
            backgroundPreset={backgroundPreset}
            onFeedbackChange={setViewerFeedback}
            onOpenFile={() => void handleOpenFile()}
            onMetadataChange={setAssetMetadata}
            onResourceDiagnosticsChange={setResourceDiagnostics}
            selectedTextureId={selectedTextureId}
            viewerSurfaceMode={viewerSurfaceMode}
            textureViewMode={textureViewMode}
            textureExposure={textureExposure}
            textureBlackPoint={textureBlackPoint}
            textureWhitePoint={textureWhitePoint}
            textureTileCount={textureTileCount}
            textureGamma={textureGamma}
            resetVersion={resetVersion}
            viewportShortcutCommand={viewportShortcutCommand}
            showGrid={showGrid}
            showAxes={showAxes}
            showSkeleton={showSkeleton}
            showBoundingBoxes={showBoundingBoxes}
            showNormals={showNormals}
            showVertexColors={showVertexColors}
            showEnvironmentBackground={showEnvironmentBackground}
            environmentRotation={environmentRotation}
            backfaceCulling={backfaceCulling}
            textureFilterMode={textureFilterMode}
            cameraPresetRequest={cameraPresetRequest}
            controlSensitivity={controlSensitivity}
            cameraFov={cameraFov}
            renderScale={renderScale}
            showShadows={showShadows}
            showUnlit={showUnlit}
            fxaaEnabled={fxaaEnabled}
            showRendererStats={showRendererStats}
            toneMappingMode={toneMappingMode}
            exposure={exposure}
            onGridUnitChange={setGridUnitLabel}
            onUsdError={recordVariantSelectionError}
            environmentPreset={environmentPreset}
            cameraSpeedMultiplier={cameraSpeedMultiplier}
            usdLoadPolicy={usdLoadPolicy}
            texturePreview3D={texturePreview3D}
            onSelectMesh={setSelectedMeshName}
            selectedMeshName={selectedMeshName}
            morphTargetValues={morphTargetValues}
            purposeModes={purposeModes}
            variantSelections={variantSelections}
            activeCameraId={activeCameraId}
            onActiveCameraReset={() => setActiveCameraId(null)}
            glbOverride={sessionGlbBuffer}
            onScaleNormalizationChange={setScaleNormalization}
            cancelScaleNormalizationVersion={cancelScaleNormalizeVersion}
          />

          <ViewportControls
            isOpen={viewportPanelOpen}
            onToggleOpen={() => setViewportPanelOpen((v) => !v)}
            items={viewportToolbarItems}
          />
          {/* #91: Cancel Scale Normalize — appears when auto-scale was applied */}
          {scaleNormalization?.applied && (
            <button
              className="cancel-scale-normalize-button"
              onClick={() => setCancelScaleNormalizeVersion((v) => v + 1)}
              type="button"
              title="Revert the auto-applied scale normalization to the original size"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 5.5L1 3.5L3 1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M1 3.5h9a3 3 0 010 6H8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Cancel Scale Normalize
            </button>
          )}
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
              <p>Drop file to open or attach motion</p>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Sidebar ── */}
      <aside
        className={`sidebar${sidebarOpen ? " is-open" : ""}`}
        style={
          sidebarOpen
            ? ({
                "--sidebar-width": `${sidebarWidth}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <div
          aria-hidden="true"
          className="sidebar-resize-handle"
          onPointerDown={handleSidebarResizeStart}
        />
        <SidebarTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          tabs={sidebarTabs}
        />
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
                className="dialog-close-button"
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

      <AppStatusBar leftItems={statusLeftItems} rightItems={statusRightItems} />
    </main>
  );
}
