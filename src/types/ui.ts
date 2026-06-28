// ── Sidebar ──────────────────────────────────────────────────────

export type SidebarTabId =
  | "properties"
  | "file"
  | "hierarchy"
  | "materials"
  | "textures"
  | "settings"
  | "warnings";

export type SidebarKeyValueRow = {
  id: string;
  label: import("react").ReactNode;
  value: import("react").ReactNode;
  tone?: "default" | "muted" | "ok" | "warn" | "danger";
  mono?: boolean;
};

// ── Compact metrics ──────────────────────────────────────────────

export type CompactMetricStatus = "neutral" | "good" | "warning" | "danger";

export type CompactMetricRow = {
  label: import("react").ReactNode;
  value: import("react").ReactNode;
  status?: CompactMetricStatus;
  mono?: boolean;
};

// ── Status bar ───────────────────────────────────────────────────

export type AppStatusBarItem = {
  id: string;
  content: import("react").ReactNode;
  mono?: boolean;
  onClick?: () => void;
  tone?: "warning" | "danger";
};

// ── Viewport toolbar icons ───────────────────────────────────────

export type ViewportToolIcon =
  | "axis"
  | "backface"
  | "bbox"
  | "camera"
  | "channel"
  | "checker"
  | "colorspace"
  | "environment"
  | "grid"
  | "inspect"
  | "light"
  | "look"
  | "matcap"
  | "normals"
  | "overlay"
  | "palette"
  | "sceneLight"
  | "shadow"
  | "skeleton"
  | "texture"
  | "tiling"
  | "uv"
  | "vertex"
  | "wireframe";

// ── Toolbar ──────────────────────────────────────────────────────

export type ToolbarMode = "3d" | "image" | "common";

export type ToolbarActionKind = "button" | "toggle" | "cycle" | "popover";

export type ToolbarActionGroup =
  | "background"
  | "camera"
  | "channel"
  | "color"
  | "inspect"
  | "look"
  | "overlay"
  | "shading"
  | "tiling"
  | "wireframe";

export type ToolbarAction = {
  id: string;
  mode: ToolbarMode;
  group: ToolbarActionGroup;
  kind: ToolbarActionKind;
  label: string;
  description?: string;
  iconId?: ViewportToolIcon;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
  onRun?: () => void;
  children?: ToolbarItem[];
};

export type ToolbarSeparator = { kind: "separator" };

export type ToolbarStatus = {
  id: string;
  mode: ToolbarMode;
  group: ToolbarActionGroup;
  kind: "status";
  label: string;
};

export type ToolbarItem = ToolbarAction | ToolbarSeparator | ToolbarStatus;

// ── Viewer shortcuts ─────────────────────────────────────────────

export type ViewerShortcutAction =
  | "focusSelected"
  | "frameAll"
  | "resetView"
  | "clearSelection"
  | "hideSelected"
  | "isolateSelected"
  | "unhideAll"
  | "cycleDisplayMode"
  | "toggleGrid";

export type ViewportShortcutCommand =
  | { kind: "focusSelected"; selectionKey: string; version: number }
  | { kind: "frameAll"; version: number }
  | { kind: "resetView"; version: number }
  | { kind: "hideSelected"; selectionKey: string; version: number }
  | { kind: "isolateSelected"; selectionKey: string; version: number }
  | { kind: "unhideAll"; version: number };

export type ViewerShortcutState = {
  showTexture: boolean;
  showWireframe: boolean;
  showGrid: boolean;
  selectedMeshName: string | null;
  selectedUsdPrimPath: string | null;
  viewportCommand: ViewportShortcutCommand | null;
};

// ── Performance ──────────────────────────────────────────────────

export type PerformanceSnapshot = {
  startupMs: number | null;
  loadMs: number | null;
  navigationMs: number | null;
  firstPaintMs: number | null;
  interactiveMs: number | null;
};
