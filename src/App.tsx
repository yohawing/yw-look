import {
  Suspense,
  lazy,
  useCallback,
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
import { MenuBar } from "./components/MenuBar";
import {
  PerformanceCard,
  type PerformanceSnapshot,
} from "./components/PerformanceCard";
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
  closeStageSession,
  collectAssetIssues,
  extractGeometrySession,
  formatUsdErrorForDisplay,
  inspectStage,
  inspectUsdLights,
  isInvalidVariantSelectionError,
  loadPayload,
  openStageSession,
  parseUsdError,
  summarizeStage,
  unloadPayload,
  type AssetIssue,
  type ExtractGeometryOptions,
  type PurposeModes,
  type StageInspection,
  type StageLoadPolicy,
  type StageSummary,
  type StageSessionHandle,
  type UsdLightInfo,
  type VariantSelection,
} from "./lib/usd";
import {
  loadDiagnosticsSnapshot,
  logDiagnosticEvent,
  type DiagnosticsPayload,
  type ResourceDiagnosticsSnapshot,
} from "./lib/diagnostics";
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
  applyViewerShortcutAction,
  isEditableShortcutTarget,
  resolveViewerShortcutAction,
  viewerShortcutHelpLines,
  type ViewportShortcutCommand,
  type ViewerShortcutAction,
} from "./lib/viewerShortcuts";
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

type SidebarTab = SidebarTabId;

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadline) => void,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const USD_EXTENSIONS = new Set(["usd", "usda", "usdc", "usdz"]);

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
  const appStartRef = useRef(performance.now());
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
  const [recentFilesPayload, setRecentFilesPayload] =
    useState<RecentFilesPayload | null>(null);
  const [recentFilesError, setRecentFilesError] = useState<string | null>(null);
  const [diagnosticsPayload, setDiagnosticsPayload] =
    useState<DiagnosticsPayload | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [resourceDiagnostics, setResourceDiagnostics] =
    useState<ResourceDiagnosticsSnapshot | null>(null);
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
  // #35: USD light details fetched directly from USD (C++ backend only).
  // `null` = not fetched yet or not a USD file; `[]` = no lights found.
  const [usdLights, setUsdLights] = useState<UsdLightInfo[] | null>(null);
  // Phase 4: deferred-payload toggle. Defaults to `noPayloads` so large
  // composed USD stages open responsively; switching to `loadAll` re-runs
  // the inspector and GLB pipeline with every payload composed.
  const [usdLoadPolicy, setUsdLoadPolicy] =
    useState<StageLoadPolicy>("noPayloads");
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

  // ---- #44 per-prim payload session ----------------------------------------
  // When the user opens a USD file with `noPayloads` policy, we also open a
  // stateful backend session so individual payload prims can be loaded and
  // unloaded on demand.  The session is closed when the file changes or the
  // component unmounts.
  const [stageSessionHandle, setStageSessionHandle] =
    useState<StageSessionHandle | null>(null);
  // All SdfPaths that author a payload arc on the current stage. Used to
  // gate the load/unload buttons in HierarchyCard so they only appear on
  // genuine payload sources, not on every regular Xform / Mesh.
  const [payloadPrimPaths, setPayloadPrimPaths] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Set of SdfPaths whose payload arcs are currently deferred. Derived from
  // `stageInspection.payloads` + individual load/unload operations.
  const [unloadedPayloadPaths, setUnloadedPayloadPaths] = useState<
    ReadonlySet<string>
  >(new Set());
  // GLB buffer produced by `extractGeometrySession` after a load/unload.
  // When non-null, `AssetViewport` should use this buffer instead of
  // re-extracting from disk. Reset to null on file change AND on variant /
  // purpose changes (the cached buffer was built against a specific variant
  // / purpose set; reusing it would freeze the viewport on the snapshot).
  const [sessionGlbBuffer, setSessionGlbBuffer] = useState<ArrayBuffer | null>(
    null,
  );

  const isTauri = isTauriEnvironment();
  const debugPanelsEnabled = !isTauri && isDebugPanelsRequested();
  const sidebarCurrentFile = debugPanelsEnabled ? debugPanelFile : currentFile;
  const sidebarAssetMetadata = debugPanelsEnabled
    ? debugPanelMetadata
    : assetMetadata;
  const sidebarDirectoryListing = debugPanelsEnabled
    ? debugPanelDirectoryListing
    : directoryListing;
  const sidebarRecentFilesPayload = debugPanelsEnabled
    ? debugPanelRecentFiles
    : recentFilesPayload;
  const sidebarRecentFilesError = debugPanelsEnabled ? null : recentFilesError;
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

    return nextWarnings;
  }, [assetMetadata?.textures, usdIssues, viewerWarningLines]);
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
    const errorCount = loadErrorCount + usdErrorCount;
    const warningCount =
      usdWarningCount + unresolvedTextureCount + viewerWarningCount;

    return {
      errorCount,
      warningCount,
      total: errorCount + warningCount,
    };
  }, [
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
      setUsdLights(null);
      setUsdInspectorLoading(false);
      setUsdInspectorError(null);
      return;
    }

    let cancelled = false;
    setUsdSummary(null);
    setUsdInspection(null);
    setUsdIssues([]);
    setUsdLights(null);
    setUsdInspectorLoading(true);
    setUsdInspectorError(null);
    // #31: reset variant selections when a new file is opened so the
    // pulldown reflects the authored defaults, not stale overrides from
    // the previous file.
    setVariantSelections([]);
    setVariantSelectionError(null);
    // #44: reset session GLB buffer on every file / policy change so the
    // viewport doesn't flash stale geometry from a previous session.
    setSessionGlbBuffer(null);

    const path = currentFile.path;

    // Summary resolves first and updates the UI immediately; the heavier
    // inspection and asset-issue RPCs land later. We only drop the
    // `loading` flag once ALL three settle so the card cannot flicker
    // back to its "Open a USD…" empty state when the fastest RPC wins
    // the race (e.g. `collect_asset_issues` returning an empty list
    // before `summarize_stage` has produced any output).
    const usdInspectorStartMs = performance.now();

    const summarizePromise = summarizeStage(path, usdLoadPolicy)
      .then((summary) => {
        if (cancelled) return;
        setUsdSummary(summary);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUsdInspectorError(
          errorMessage(error, "Failed to summarize USD stage."),
        );
      });

    const inspectPromise = inspectStage(path, usdLoadPolicy)
      .then((inspection) => {
        if (cancelled) return;
        setUsdInspection(inspection);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Keep any earlier summarize error; otherwise record this one.
        setUsdInspectorError(
          (previous) =>
            previous ?? errorMessage(error, "Failed to inspect USD stage."),
        );
      });

    const issuesPromise =
      usdLoadPolicy === "loadAll"
        ? collectAssetIssues(path)
            .then((issues) => {
              if (cancelled) return;
              setUsdIssues(issues);
            })
            .catch((error: unknown) => {
              if (cancelled) return;
              setUsdInspectorError(
                (previous) =>
                  previous ??
                  errorMessage(error, "Failed to collect USD asset issues."),
              );
            })
        : Promise.resolve();

    // #35: fetch USD light details from the C++ backend.
    // Errors are silently ignored — the Rust-fork backend returns an error
    // and in that case we fall back to the Three.js LightEntry list.
    const lightsPromise =
      usdLoadPolicy === "loadAll"
        ? inspectUsdLights(path)
            .then((lights) => {
              if (cancelled) return;
              setUsdLights(lights);
            })
            .catch(() => {
              // Degraded: C++ backend not available or backend error — leave
              // usdLights as null so the UI falls back to Three.js LightEntry data.
            })
        : Promise.resolve();

    void Promise.allSettled([
      summarizePromise,
      inspectPromise,
      issuesPromise,
      lightsPromise,
    ]).then(() => {
      if (cancelled) return;
      setUsdInspectorLoading(false);
      const elapsedMs = Math.round(performance.now() - usdInspectorStartMs);
      console.info(
        `[usd] inspector RPCs settled in ${elapsedMs}ms (policy=${usdLoadPolicy}): ${path}`,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [currentFile, isTauri, usdLoadPolicy]);

  // #44: open a stateful stage session when a USD file is loaded with
  // `noPayloads` policy (enables per-prim load/unload). Close any previous
  // session first. When `loadAll` is active no session is needed.
  useEffect(() => {
    if (!isTauri || !isUsdFile(currentFile) || !currentFile) {
      setStageSessionHandle(null);
      setUnloadedPayloadPaths(new Set());
      return;
    }

    // Only open a session when using noPayloads — loadAll doesn't need it.
    if (usdLoadPolicy !== "noPayloads") {
      setStageSessionHandle(null);
      setUnloadedPayloadPaths(new Set());
      return;
    }

    let cancelled = false;
    const path = currentFile.path;

    openStageSession(path, "noPayloads")
      .then((handle) => {
        if (cancelled) {
          // Cleanup ran before this promise resolved — don't leak the
          // handle on the backend. Issue close in the background and
          // ignore errors (the registry tolerates missing handles).
          closeStageSession(handle).catch(() => {});
          return;
        }
        setStageSessionHandle(handle);
        // Initially all payload sources are unloaded — the session was opened
        // with noPayloads. The exact set of paths will be populated once
        // stageInspection settles (via the effect below that syncs payloads).
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn(
          "[usd] open_stage_session failed (per-prim load/unload unavailable):",
          err,
        );
        setStageSessionHandle(null);
      });

    return () => {
      cancelled = true;
      // Close the session asynchronously — we don't await here to avoid
      // blocking the cleanup. The backend will free the stage.
      setStageSessionHandle((prev) => {
        if (prev !== null) {
          void closeStageSession(prev).catch(() => {
            // Silently ignore close errors — the Tauri process is likely
            // already shutting down or the file was closed.
          });
        }
        return null;
      });
    };
  }, [currentFile, isTauri, usdLoadPolicy]);

  // #44: re-sync the session GLB cache when the user changes variants —
  // but ONLY after the user has actually mutated payloads (i.e. an
  // override is already in flight). For an untouched session the regular
  // `requiresGlbPreview`/`extractGeometry` path in loaders.ts handles
  // variants correctly; forcing a session re-extract here would bypass
  // that path even on self-contained USDA files that should go through
  // the Three.js USDLoader.
  //
  // Purpose toggles are deliberately NOT a dependency: AssetViewport
  // applies purpose visibility client-side via `applyPurposeVisibility`,
  // so the GLB does not need re-extraction when only purpose changes.
  const sessionGlbBufferRef = useRef<ArrayBuffer | null>(sessionGlbBuffer);
  useEffect(() => {
    sessionGlbBufferRef.current = sessionGlbBuffer;
  }, [sessionGlbBuffer]);

  useEffect(() => {
    if (stageSessionHandle === null) {
      // No session: drop any leftover override; the stateless extract
      // path picks up the latest variants on the next render.
      setSessionGlbBuffer(null);
      return;
    }
    if (sessionGlbBufferRef.current === null) {
      // Session is open but the user has not yet load/unload-ed any
      // payload. Leave the override null so loaders.ts uses the regular
      // `requiresGlbPreview` decision tree.
      return;
    }
    let cancelled = false;
    extractGeometrySession(stageSessionHandle, {
      policy: "noPayloads",
      variantSelections,
      purposeModes,
    })
      .then((buf) => {
        if (!cancelled) setSessionGlbBuffer(buf);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("[usd] session re-extract on variant change failed:", err);
        recordVariantSelectionError(err);
        setSessionGlbBuffer(null);
      });
    return () => {
      cancelled = true;
    };
    // `purposeModes` is captured by closure for defensive completeness
    // but is intentionally NOT in the deps array — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantSelections, stageSessionHandle]);

  // #44: sync payload prim sets from `usdInspection`. `payloadPrimPaths`
  // contains every prim that authors a payload arc (used to gate the
  // HierarchyCard load/unload buttons). `unloadedPayloadPaths` is the
  // currently-deferred subset; later individual load/unload operations
  // mutate it directly.
  useEffect(() => {
    if (!usdInspection || usdLoadPolicy !== "noPayloads") {
      setPayloadPrimPaths(new Set());
      setUnloadedPayloadPaths(new Set());
      return;
    }
    const allPayloads = new Set(
      usdInspection.payloads.map((arc) => arc.sourcePrim),
    );
    const unloaded = new Set(
      usdInspection.payloads
        .filter((arc) => arc.state === "unloaded")
        .map((arc) => arc.sourcePrim),
    );
    setPayloadPrimPaths(allPayloads);
    setUnloadedPayloadPaths(unloaded);
  }, [usdInspection, usdLoadPolicy]);

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

  // #26: when the user has opted in via Settings, run a single
  // `check_for_update` call once `settingsPayload` has loaded.
  // Intentionally NOT gated on `shouldLoadDeferredData` (the sidebar
  // toggle) — the user may run with the sidebar collapsed, and a
  // pending update should still surface on startup. `check_for_update`
  // returns the update configuration alongside the result, so we do
  // not need a separate `load_update_configuration` round-trip first.
  // The auto-check is one-shot per session; a polling enhancement is
  // out of scope for #26's first surface.
  const autoUpdateCheckedRef = useRef(false);
  useEffect(() => {
    if (autoUpdateCheckedRef.current) return;
    if (!settingsPayload?.settings.autoCheckForUpdates) return;
    autoUpdateCheckedRef.current = true;
    void handleCheckForUpdate();
  }, [settingsPayload?.settings.autoCheckForUpdates]);

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

  useEffect(() => {
    const handleViewerShortcutDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      const action = resolveViewerShortcutAction(event);
      if (!action) {
        return;
      }

      event.preventDefault();
      runViewerShortcutAction(action);
    };

    window.addEventListener("keydown", handleViewerShortcutDown);
    return () => {
      window.removeEventListener("keydown", handleViewerShortcutDown);
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

  const runMenuActionFromShortcut = useEffectEvent((actionId: MenuActionId) => {
    void executeMenuAction(actionId);
  });
  const runViewerShortcutAction = useEffectEvent(
    (action: ViewerShortcutAction) => {
      executeViewerShortcutAction(action);
    },
  );
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

      if (isEditableShortcutTarget(event.target)) {
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

  const handleCheckForUpdate = async () => {
    try {
      setIsCheckingForUpdate(true);
      const payload = await checkForUpdate();
      setUpdateCheck(payload);
      setUpdateConfiguration(payload.configuration);
      setUpdateError(null);
    } catch (error: unknown) {
      setUpdateError(errorMessage(error, "Failed to check for updates."));
    } finally {
      setIsCheckingForUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    try {
      setIsInstallingUpdate(true);
      setUpdateError(
        "Installing update. On Windows, yw-look may close and relaunch before this panel receives a final result.",
      );
      const payload = await installPendingUpdate();
      setUpdateError(payload.note);
      setUpdateCheck(null);
    } catch (error: unknown) {
      setUpdateError(errorMessage(error, "Failed to install update."));
    } finally {
      setIsInstallingUpdate(false);
    }
  };

  // #44: per-prim payload load/unload. Calls the backend, updates the local
  // unloaded set optimistically, then re-extracts the GLB from the session.
  // The re-extract carries the user's variantSelections / purposeModes so a
  // payload toggle does not silently revert any non-default variant or
  // purpose mode the user picked from the inspector.
  //
  // A ref mirrors the latest `stageSessionHandle` so the async handlers
  // can detect when the user has navigated away (file change, policy
  // toggle, app close) between the IPC dispatch and its resolution. In
  // that case we drop the stale write rather than overwrite the new
  // file's `sessionGlbBuffer` / `unloadedPayloadPaths` with values from
  // a session that no longer exists.
  const stageSessionHandleRef = useRef<StageSessionHandle | null>(
    stageSessionHandle,
  );
  useEffect(() => {
    stageSessionHandleRef.current = stageSessionHandle;
  }, [stageSessionHandle]);

  const buildSessionExtractOptions = (): ExtractGeometryOptions => ({
    policy: "noPayloads",
    variantSelections,
    purposeModes,
  });

  const handleLoadPayload = async (primPath: string) => {
    const captured = stageSessionHandle;
    if (captured === null) return;
    try {
      await loadPayload(captured, primPath);
      if (stageSessionHandleRef.current !== captured) return;
      setUnloadedPayloadPaths((prev) => {
        const next = new Set(prev);
        next.delete(primPath);
        return next;
      });
    } catch (err: unknown) {
      console.error("[usd] load_payload failed:", err);
      return;
    }
    // Re-extract is best-effort: if it fails (e.g. backend hits "no
    // renderable Mesh prims"), drop the override so the viewport doesn't
    // keep the pre-load geometry on screen and falls back to the
    // stateless extract path.
    try {
      const glbBuffer = await extractGeometrySession(
        captured,
        buildSessionExtractOptions(),
      );
      if (stageSessionHandleRef.current !== captured) return;
      setSessionGlbBuffer(glbBuffer);
    } catch (err: unknown) {
      if (stageSessionHandleRef.current !== captured) return;
      console.warn("[usd] session re-extract after load failed:", err);
      recordVariantSelectionError(err);
      setSessionGlbBuffer(null);
    }
  };

  const handleUnloadPayload = async (primPath: string) => {
    const captured = stageSessionHandle;
    if (captured === null) return;
    try {
      await unloadPayload(captured, primPath);
      if (stageSessionHandleRef.current !== captured) return;
      setUnloadedPayloadPaths((prev) => {
        const next = new Set(prev);
        next.add(primPath);
        return next;
      });
    } catch (err: unknown) {
      console.error("[usd] unload_payload failed:", err);
      return;
    }
    // Same best-effort re-extract: if the unloaded stage has no
    // renderable meshes the extract returns an error; clear the override
    // so the viewport doesn't keep showing the pre-unload geometry.
    try {
      const glbBuffer = await extractGeometrySession(
        captured,
        buildSessionExtractOptions(),
      );
      if (stageSessionHandleRef.current !== captured) return;
      setSessionGlbBuffer(glbBuffer);
    } catch (err: unknown) {
      if (stageSessionHandleRef.current !== captured) return;
      console.warn("[usd] session re-extract after unload failed:", err);
      recordVariantSelectionError(err);
      setSessionGlbBuffer(null);
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
            {sidebarAssetMetadata &&
              !isUsdFile(currentFile) &&
              selectedMeshName && (
                <ObjectInspectorCard
                  selectedKey={selectedMeshName}
                  objectInfo={
                    sidebarAssetMetadata.objectInfo[selectedMeshName] ?? null
                  }
                  metadata={sidebarAssetMetadata}
                />
              )}
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
  }, []);

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
  }, [
    currentFileSummary,
    openUpdatePanel,
    performanceSnapshot,
    updateCheck?.update,
  ]);

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
      {/* ── MenuBar ── */}
      {isTauri ? null : (
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
              <p>Drop file to open</p>
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

      <AppStatusBar leftItems={statusLeftItems} rightItems={statusRightItems} />
    </main>
  );
}
