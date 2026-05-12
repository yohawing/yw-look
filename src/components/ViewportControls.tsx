import { useState, type ReactNode } from "react";

import "../styles/viewport.css";
import { ViewportToolSvg, type ViewportToolIcon } from "./ViewportToolIcons";

export type ViewportControlOption<T extends string = string> = {
  id: T;
  label: string;
  title?: string;
};

export type ViewportPurposeModes = {
  render: boolean;
  proxy: boolean;
  guide: boolean;
};

type ViewportToolItem = {
  key: string;
  icon: ViewportToolIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  kind?: "button" | "toggle";
  title?: string;
};

export type ViewportControlsProps<
  TBackgroundPreset extends string = string,
  TEnvironmentPreset extends string = string,
  TCameraPreset extends string = string,
> = {
  isOpen?: boolean;
  onToggleOpen?: () => void;
  showTexture: boolean;
  onToggleTexture: () => void;
  showWireframe: boolean;
  onToggleWireframe: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  orthoMode?: boolean;
  onToggleOrthoMode?: () => void;
  showAxes?: boolean;
  onToggleAxes?: () => void;
  showEnvironmentBackground?: boolean;
  onToggleEnvironmentBackground?: () => void;
  showShadows?: boolean;
  onToggleShadows?: () => void;
  backfaceCulling?: boolean;
  onToggleBackfaceCulling?: () => void;
  showSkeleton?: boolean;
  onToggleSkeleton?: () => void;
  showBoundingBoxes?: boolean;
  onToggleBoundingBoxes?: () => void;
  showVertexColors?: boolean;
  onToggleVertexColors?: () => void;
  showNormals?: boolean;
  onToggleNormals?: () => void;
  purposeModes?: ViewportPurposeModes;
  onTogglePurposeMode?: (mode: keyof ViewportPurposeModes) => void;
  backgroundPreset?: TBackgroundPreset;
  backgroundPresetOptions?: Array<ViewportControlOption<TBackgroundPreset>>;
  onSelectBackgroundPreset?: (preset: TBackgroundPreset) => void;
  environmentPreset?: TEnvironmentPreset;
  environmentPresetOptions?: Array<ViewportControlOption<TEnvironmentPreset>>;
  onSelectEnvironmentPreset?: (preset: TEnvironmentPreset) => void;
  cameraPresetOptions?: Array<ViewportControlOption<TCameraPreset>>;
  onSelectCameraPreset?: (preset: TCameraPreset) => void;
};

function ViewportTool({
  active = false,
  icon,
  kind = "toggle",
  label,
  onClick,
  title,
}: ViewportToolItem) {
  return (
    <button
      aria-label={label}
      aria-pressed={kind === "toggle" ? active : undefined}
      className={`viewport-tool${active ? " is-active" : ""}`}
      data-tooltip={title ?? label}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      <ViewportToolSvg icon={icon} />
    </button>
  );
}

function Separator() {
  return <span className="viewport-tool-separator" aria-hidden="true" />;
}

function ViewportToolGroup({ children }: { children: ReactNode }) {
  return <div className="viewport-tool-group">{children}</div>;
}

function firstOption<TOption extends string>(
  options: Array<ViewportControlOption<TOption>> | undefined,
): TOption | null {
  return options?.[0]?.id ?? null;
}

function nextOption<TOption extends string>(
  options: Array<ViewportControlOption<TOption>> | undefined,
  currentValue: TOption | undefined,
): TOption | null {
  if (!options?.length) return null;
  const currentIndex = options.findIndex(
    (option) => option.id === currentValue,
  );
  return options[(currentIndex + 1) % options.length].id;
}

export function ViewportControls<
  TBackgroundPreset extends string = string,
  TEnvironmentPreset extends string = string,
  TCameraPreset extends string = string,
>({
  isOpen = true,
  onToggleOpen,
  showTexture,
  onToggleTexture,
  showWireframe,
  onToggleWireframe,
  showGrid,
  onToggleGrid,
  orthoMode,
  onToggleOrthoMode,
  showAxes,
  onToggleAxes,
  showEnvironmentBackground,
  onToggleEnvironmentBackground,
  showShadows,
  onToggleShadows,
  backfaceCulling,
  onToggleBackfaceCulling,
  showSkeleton,
  onToggleSkeleton,
  showBoundingBoxes,
  onToggleBoundingBoxes,
  showVertexColors,
  onToggleVertexColors,
  showNormals,
  onToggleNormals,
  purposeModes,
  onTogglePurposeMode,
  backgroundPreset,
  backgroundPresetOptions,
  onSelectBackgroundPreset,
  environmentPreset,
  environmentPresetOptions,
  onSelectEnvironmentPreset,
  cameraPresetOptions,
  onSelectCameraPreset,
}: ViewportControlsProps<
  TBackgroundPreset,
  TEnvironmentPreset,
  TCameraPreset
>) {
  const [selectedCameraPreset, setSelectedCameraPreset] =
    useState<TCameraPreset | null>(null);
  const nextCameraPreset =
    nextOption(cameraPresetOptions, selectedCameraPreset ?? undefined) ??
    firstOption(cameraPresetOptions);
  const nextBackground = nextOption(backgroundPresetOptions, backgroundPreset);
  const nextEnvironment = nextOption(
    environmentPresetOptions,
    environmentPreset,
  );
  const nextCameraLabel =
    cameraPresetOptions?.find((option) => option.id === nextCameraPreset)
      ?.label ?? "Camera";

  if (!isOpen) {
    return (
      <aside className="viewport-controls is-closed" aria-label="Viewport HUD">
        <button
          aria-label="Open viewport tools"
          className="viewport-tool"
          data-tooltip="Viewport tools"
          onClick={onToggleOpen}
          title="Viewport tools"
          type="button"
        >
          <ViewportToolSvg icon="palette" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="viewport-controls" aria-label="Viewport HUD">
      <ViewportToolGroup>
        {nextCameraPreset && onSelectCameraPreset ? (
          <ViewportTool
            icon="camera"
            key="frame-camera"
            kind="button"
            label={`${nextCameraLabel} view`}
            onClick={() => {
              setSelectedCameraPreset(nextCameraPreset);
              onSelectCameraPreset(nextCameraPreset);
            }}
            title={`${nextCameraLabel} view`}
          />
        ) : null}
        {onToggleOrthoMode && typeof orthoMode === "boolean" ? (
          <ViewportTool
            active={orthoMode}
            icon="ortho"
            key="ortho-mode"
            label={orthoMode ? "Perspective" : "Orthographic"}
            onClick={onToggleOrthoMode}
            title={orthoMode ? "Switch to perspective" : "Switch to orthographic"}
          />
        ) : null}
        {nextBackground && onSelectBackgroundPreset ? (
          <ViewportTool
            icon="palette"
            key="background"
            kind="button"
            label="Cycle background"
            onClick={() => onSelectBackgroundPreset(nextBackground)}
            title="Background"
          />
        ) : null}
      </ViewportToolGroup>

      <Separator />

      <ViewportToolGroup>
        <ViewportTool
          active={showGrid}
          icon="grid"
          key="grid"
          label="Grid"
          onClick={onToggleGrid}
        />
        {onToggleAxes && typeof showAxes === "boolean" ? (
          <ViewportTool
            active={showAxes}
            icon="axis"
            key="axes"
            label="Axes"
            onClick={onToggleAxes}
          />
        ) : null}
        {onToggleEnvironmentBackground &&
        typeof showEnvironmentBackground === "boolean" ? (
          <ViewportTool
            active={showEnvironmentBackground}
            icon="environment"
            key="environment-background"
            label="Environment background"
            onClick={onToggleEnvironmentBackground}
          />
        ) : null}
        {nextEnvironment && onSelectEnvironmentPreset ? (
          <ViewportTool
            icon="light"
            key="environment"
            kind="button"
            label="Environment preset"
            onClick={() => onSelectEnvironmentPreset(nextEnvironment)}
            title="Environment"
          />
        ) : null}
        {onToggleShadows && typeof showShadows === "boolean" ? (
          <ViewportTool
            active={showShadows}
            icon="light"
            key="shadows"
            label="Shadows"
            onClick={onToggleShadows}
          />
        ) : null}
      </ViewportToolGroup>

      <Separator />

      <ViewportToolGroup>
        <ViewportTool
          active={!showTexture}
          icon="texture"
          key="texture"
          label={showTexture ? "Hide textures" : "Show textures"}
          onClick={onToggleTexture}
        />
        <ViewportTool
          active={showWireframe}
          icon="wireframe"
          key="wireframe"
          label="Wireframe"
          onClick={onToggleWireframe}
        />
        {onToggleBackfaceCulling && typeof backfaceCulling === "boolean" ? (
          <ViewportTool
            active={backfaceCulling}
            icon="backface"
            key="backface-culling"
            label="Backface culling"
            onClick={onToggleBackfaceCulling}
          />
        ) : null}
        {onToggleNormals && typeof showNormals === "boolean" ? (
          <ViewportTool
            active={showNormals}
            icon="normals"
            key="normals"
            label="Normals"
            onClick={onToggleNormals}
          />
        ) : null}
        {onToggleVertexColors && typeof showVertexColors === "boolean" ? (
          <ViewportTool
            active={showVertexColors}
            icon="vertex"
            key="vertex-colors"
            label="Vertex colors"
            onClick={onToggleVertexColors}
          />
        ) : null}
        {onToggleSkeleton && typeof showSkeleton === "boolean" ? (
          <ViewportTool
            active={showSkeleton}
            icon="skeleton"
            key="skeleton"
            label="Skeleton"
            onClick={onToggleSkeleton}
          />
        ) : null}
        {onToggleBoundingBoxes && typeof showBoundingBoxes === "boolean" ? (
          <ViewportTool
            active={showBoundingBoxes}
            icon="bbox"
            key="bounding-boxes"
            label="Bounding boxes"
            onClick={onToggleBoundingBoxes}
          />
        ) : null}
      </ViewportToolGroup>

      {purposeModes && onTogglePurposeMode ? (
        <>
          <Separator />
          <ViewportToolGroup>
            {(["render", "proxy", "guide"] as const).map((mode) => (
              <ViewportTool
                active={purposeModes[mode]}
                icon="palette"
                key={mode}
                label={`USD purpose: ${mode}`}
                onClick={() => onTogglePurposeMode(mode)}
              />
            ))}
          </ViewportToolGroup>
        </>
      ) : null}
    </aside>
  );
}
