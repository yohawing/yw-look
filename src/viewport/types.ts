import type { ResourceDiagnosticsSnapshot } from "../lib/diagnostics";
import type { SelectedFile } from "../lib/files";
import type {
  PurposeModes,
  StageInspection,
  StageLoadPolicy,
  VariantSelection,
} from "../lib/usd";
import type { ViewportShortcutCommand } from "../lib/viewerShortcuts";
import type {
  BackgroundPreset,
  CameraPresetRequest,
  DisplayMode,
  EnvironmentPreset,
  AssetMetadata,
  TextureFilterMode,
  TextureViewMode,
  ToneMappingMode,
  ViewerFeedback,
  ViewerSurfaceMode,
} from "../types/viewer";
import type { DeferredTextureSnapshot } from "../viewer";

export type RuntimePreviewUpdater = {
  update: (deltaSeconds: number) => void;
};

export type AssetViewportProps = {
  currentFile: SelectedFile | null;
  disabledOptionalLoaderPackIds?: readonly string[];
  incompatibleOptionalLoaderPackIds?: readonly string[];
  mmdMotionRequest?: {
    file: SelectedFile;
    version: number;
  } | null;
  displayMode: DisplayMode;
  backgroundPreset: BackgroundPreset;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  onOpenFile?: () => void;
  onUsdError?: (error: unknown) => void;
  onMetadataChange: (metadata: AssetMetadata | null) => void;
  onResourceDiagnosticsChange?: (
    snapshot: ResourceDiagnosticsSnapshot | null,
  ) => void;
  selectedTextureId: string | null;
  viewerSurfaceMode: ViewerSurfaceMode;
  textureViewMode: TextureViewMode;
  textureExposure: number;
  textureBlackPoint: number;
  textureWhitePoint: number;
  textureTileCount: number;
  textureGamma: number;
  resetVersion: number;
  viewportShortcutCommand?: ViewportShortcutCommand | null;
  showGrid: boolean;
  showAxes: boolean;
  showSkeleton: boolean;
  showLocalAxis: boolean;
  showJointNames: boolean;
  showBoundingBoxes: boolean;
  showNormals: boolean;
  showVertexColors: boolean;
  showEnvironmentBackground: boolean;
  environmentRotation: number;
  backfaceCulling: boolean;
  textureFilterMode: TextureFilterMode;
  cameraPresetRequest: CameraPresetRequest | null;
  controlSensitivity: number;
  cameraFov: number;
  renderScale: number;
  showShadows: boolean;
  showUnlit: boolean;
  fxaaEnabled: boolean;
  showRendererStats: boolean;
  toneMappingMode: ToneMappingMode;
  exposure: number;
  onGridUnitChange: (label: string) => void;
  environmentPreset: EnvironmentPreset;
  /** Multiplier applied on top of the auto-computed sensitivity (0.25 - 4). */
  cameraSpeedMultiplier: number;
  /**
   * Phase 4 USD load policy. Default `"loadAll"` preserves Phase 3
   * behavior. When this changes the viewport reloads the preview with
   * the new policy so deferred payloads take effect.
   */
  usdLoadPolicy?: StageLoadPolicy;
  usdInspection?: StageInspection | null;
  /**
   * When `true`, the texture preview plane is framed with the same
   * orbit-style controls as a 3D asset so the user can rotate/zoom
   * around it. Defaults to `false` (flat 2D pan/zoom view) which is
   * the canonical image-viewer behavior and matches what users expect
   * for a quick texture inspection.
   */
  texturePreview3D: boolean;
  /**
   * Fired when the user single-clicks the viewport (#33). Receives the
   * `Object3D.name` of the picked mesh, or `null` when the click misses
   * any geometry. Drags are not treated as clicks (a small movement
   * threshold filters orbit/pan gestures out). The string is the live
   * Three.js object name - for the GLB-routed USD path this is the
   * authored prim path the Rust backend stamps on each mesh node, and
   * for the Three.js USDLoader path it is whatever the loader assigned.
   * App.tsx feeds the value into the hierarchy panel so the tree can
   * scroll to and highlight the picked prim.
   */
  onSelectMesh?: (meshName: string | null) => void;
  /**
   * Currently selected mesh name driven by the hierarchy tree (#33 reverse
   * direction: tree -> viewport). When this changes the viewport applies a
   * selection tint to the matching mesh; `null` clears any active tint.
   */
  selectedMeshName?: string | null;
  morphTargetValues?: Record<string, Record<number, number>>;
  /**
   * #32: USD purpose visibility filter. `default` purpose is always shown.
   * Each of render / proxy / guide is independently toggled. When undefined
   * the viewport behaves as if render=true, proxy=false, guide=false which
   * matches the pre-#32 behavior.
   */
  purposeModes?: PurposeModes;
  /**
   * #31: USD variant selections applied before geometry extraction.
   * When this array changes the GLB pipeline is re-run with the new
   * selections so the variant switch is reflected in the viewport.
   * Ignored for non-USD files and the USDA single-buffer path.
   */
  variantSelections?: VariantSelection[];
  /**
   * #34: Name of the USD camera to use as the active viewport camera.
   * `null` (default) keeps the free-orbit PerspectiveCamera.
   * When a value is set the viewport traverses the scene graph, finds the
   * matching PerspectiveCamera node (by stripped name), uses it for
   * rendering, and disables OrbitControls so the transform is USD-driven.
   * The fly-cam (RMB+WASD) is also blocked while a USD camera is active.
   *
   * Uses the camera's stable Three.js uuid rather than its authored name
   * so duplicate or unnamed cameras stay independently selectable.
   */
  activeCameraId?: string | null;
  /** Called when the previously-selected USD camera disappears after a
   * reload (variant / load-policy change -> new Three.js scene with fresh
   * uuids). The viewport falls back to the free camera but the React
   * state in App.tsx still points at a uuid that no longer exists; this
   * callback lets App reset that state so the UI is consistent and fly
   * mode becomes available again. */
  onActiveCameraReset?: () => void;
  /**
   * #44: when non-null the viewport loads this pre-extracted GLB buffer
   * directly instead of re-extracting from the file path. Used by the
   * per-prim payload session so the viewport reflects the current payload
   * load state without a full round-trip through the extraction pipeline.
   * Setting to `null` or omitting reverts to the normal file-based path.
   */
  glbOverride?: ArrayBuffer | null;
  deferredProgress?: DeferredTextureSnapshot | null;
  /**
   * #91: Called when scale normalization is applied or reverted.
   * Parent can use this to show/hide the "Cancel Scale Normalize" button.
   */
  onScaleNormalizationChange?: (
    normalization: { applied: boolean; factor: number } | null,
  ) => void;
  /**
   * #91: Version counter. When incremented, the viewport cancels
   * (reverts) the current scale normalization and resets the object
   * to its original size. Follows the same pattern as resetVersion.
   */
  cancelScaleNormalizationVersion?: number;
};
