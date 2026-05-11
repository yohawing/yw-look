import type { ViewportToolIcon } from "../ViewportToolIcons";

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

export type ToolbarItem = ToolbarAction | ToolbarSeparator;
