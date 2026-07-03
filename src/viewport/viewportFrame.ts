import type { Camera, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { FxaaComposerState } from "./fxaa";
import type { FlyCameraControls } from "./flyCamera";
import { updateRuntimePreview } from "./previewSupport";
import { RESOURCE_DIAGNOSTICS_SAMPLE_MS } from "./resourceDiagnostics";
import type { SceneContext, ViewerSurfaceMode } from "../types/viewer";

type RenderViewportFrameOptions = {
  activeCamera: Camera | null;
  defaultCamera: PerspectiveCamera;
  fxaaEnabled: boolean;
  fxaaState: FxaaComposerState | null;
  labelRenderer: CSS2DRenderer;
  renderer: WebGLRenderer;
  scene: Scene;
};

export function renderViewportFrame({
  activeCamera,
  defaultCamera,
  fxaaEnabled,
  fxaaState,
  labelRenderer,
  renderer,
  scene,
}: RenderViewportFrameOptions): void {
  const renderCamera = activeCamera ?? defaultCamera;
  if (fxaaEnabled && fxaaState) {
    fxaaState.renderPass.camera = renderCamera;
    fxaaState.composer.render();
  } else {
    renderer.render(scene, renderCamera);
  }
  labelRenderer.render(scene, renderCamera);
}

export type ViewportRuntimeStatsState = {
  frameCount: number;
  lastFps: number;
  lastSampled: number;
  resourceDiagnosticsLastSampled: number;
};

export function createViewportRuntimeStatsState(
  now = performance.now(),
): ViewportRuntimeStatsState {
  return {
    frameCount: 0,
    lastFps: 0,
    lastSampled: now,
    resourceDiagnosticsLastSampled: 0,
  };
}

type SampleViewportRuntimeStatsOptions = {
  now: number;
  publishResourceDiagnostics: (context: SceneContext | null) => void;
  renderer: WebGLRenderer;
  sceneContext: SceneContext | null;
  state: ViewportRuntimeStatsState;
  statsNode: HTMLDivElement | null;
};

export function sampleViewportRuntimeStats({
  now,
  publishResourceDiagnostics,
  renderer,
  sceneContext,
  state,
  statsNode,
}: SampleViewportRuntimeStatsOptions): void {
  state.frameCount += 1;
  const elapsed = now - state.lastSampled;
  if (elapsed < 250) {
    return;
  }

  state.lastFps = (state.frameCount * 1000) / elapsed;
  state.frameCount = 0;
  state.lastSampled = now;
  if (statsNode) {
    const info = renderer.info;
    statsNode.textContent = [
      `${state.lastFps.toFixed(0)} fps`,
      `${info.render.calls} calls`,
      `${info.render.triangles.toLocaleString()} tri`,
      `${info.memory.geometries} geo / ${info.memory.textures} tex`,
    ].join("  •  ");
  }
  if (
    now - state.resourceDiagnosticsLastSampled >=
    RESOURCE_DIAGNOSTICS_SAMPLE_MS
  ) {
    state.resourceDiagnosticsLastSampled = now;
    publishResourceDiagnostics(sceneContext);
  }
}

type TickViewportFrameOptions = {
  activeCamera: Camera | null;
  controls: Pick<OrbitControls, "update">;
  defaultCamera: PerspectiveCamera;
  flyCameraControls: Pick<FlyCameraControls, "update">;
  frameNow: number;
  fxaaEnabled: boolean;
  fxaaState: FxaaComposerState | null;
  labelRenderer: CSS2DRenderer;
  previousRenderTimestamp: number;
  publishResourceDiagnostics: (context: SceneContext | null) => void;
  renderer: WebGLRenderer;
  scene: Scene;
  sceneContext: SceneContext | null;
  statsNode: HTMLDivElement | null;
  statsState: ViewportRuntimeStatsState;
  viewerSurfaceMode: ViewerSurfaceMode;
};

export function tickViewportFrame({
  activeCamera,
  controls,
  defaultCamera,
  flyCameraControls,
  frameNow,
  fxaaEnabled,
  fxaaState,
  labelRenderer,
  previousRenderTimestamp,
  publishResourceDiagnostics,
  renderer,
  scene,
  sceneContext,
  statsNode,
  statsState,
  viewerSurfaceMode,
}: TickViewportFrameOptions): number {
  const deltaSeconds = Math.min(
    0.1,
    (frameNow - previousRenderTimestamp) / 1000,
  );

  if (!flyCameraControls.update(frameNow)) {
    controls.update();
  }

  if (viewerSurfaceMode === "asset") {
    updateRuntimePreview(sceneContext, deltaSeconds);
  }

  renderViewportFrame({
    activeCamera,
    defaultCamera,
    fxaaEnabled,
    fxaaState,
    labelRenderer,
    renderer,
    scene,
  });
  sampleViewportRuntimeStats({
    now: frameNow,
    publishResourceDiagnostics,
    renderer,
    sceneContext,
    state: statsState,
    statsNode,
  });

  return frameNow;
}
