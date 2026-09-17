import {
  Color,
  type Camera,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { syncViewportComposerCamera, type ViewportComposerState } from "./fxaa";
import type { FlyCameraControls } from "./flyCamera";
import { updateRuntimePreview } from "./previewSupport";
import { RESOURCE_DIAGNOSTICS_SAMPLE_MS } from "./resourceDiagnostics";
import type { SceneContext, ViewerSurfaceMode } from "../types/viewer";

type RenderViewportFrameOptions = {
  activeCamera: Camera | null;
  ambientOcclusionEnabled?: boolean;
  defaultCamera: PerspectiveCamera;
  fxaaEnabled: boolean;
  fxaaState: ViewportComposerState | null;
  labelRenderer: CSS2DRenderer;
  renderer: WebGLRenderer;
  scene: Scene;
};

const composerClearColors = new WeakMap<WebGLRenderer, Color>();

function renderComposerWithRestoredState(
  state: ViewportComposerState,
  renderer: WebGLRenderer,
  scene: Scene,
) {
  let clearColor = composerClearColors.get(renderer);
  if (!clearColor) {
    clearColor = new Color();
    composerClearColors.set(renderer, clearColor);
  }
  renderer.getClearColor(clearColor);
  const clearAlpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  const overrideMaterial = scene.overrideMaterial;
  const visiblePointsAndLines: Object3D[] = [];
  scene.traverse((object) => {
    const renderObject = object as Object3D & {
      isLine?: boolean;
      isLine2?: boolean;
      isPoints?: boolean;
    };
    if (
      object.visible &&
      (renderObject.isPoints || renderObject.isLine || renderObject.isLine2)
    ) {
      visiblePointsAndLines.push(object);
    }
  });

  try {
    state.composer.render();
  } finally {
    scene.overrideMaterial = overrideMaterial;
    renderer.autoClear = autoClear;
    renderer.setClearColor(clearColor);
    renderer.setClearAlpha(clearAlpha);
    for (const object of visiblePointsAndLines) object.visible = true;
  }
}

export function renderViewportFrame({
  activeCamera,
  ambientOcclusionEnabled = false,
  defaultCamera,
  fxaaEnabled,
  fxaaState,
  labelRenderer,
  renderer,
  scene,
}: RenderViewportFrameOptions): void {
  const renderCamera = activeCamera ?? defaultCamera;
  const useAmbientOcclusion =
    ambientOcclusionEnabled &&
    (renderCamera as Camera & { isPerspectiveCamera?: boolean })
      .isPerspectiveCamera === true;
  if ((useAmbientOcclusion || fxaaEnabled) && fxaaState && !fxaaState.failed) {
    fxaaState.ssaoPass.enabled = useAmbientOcclusion;
    fxaaState.fxaaPass.enabled = fxaaEnabled;
    syncViewportComposerCamera(fxaaState, renderCamera);
    try {
      renderComposerWithRestoredState(fxaaState, renderer, scene);
    } catch (error) {
      fxaaState.failed = true;
      renderer.setRenderTarget(null);
      console.warn(
        "[viewer] post-processing render failed; using direct rendering",
        error,
      );
      renderer.render(scene, renderCamera);
    }
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
  ambientOcclusionEnabled?: boolean;
  controls: Pick<OrbitControls, "update">;
  defaultCamera: PerspectiveCamera;
  flyCameraControls: Pick<FlyCameraControls, "update">;
  frameNow: number;
  fxaaEnabled: boolean;
  fxaaState: ViewportComposerState | null;
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
  ambientOcclusionEnabled = false,
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
    sceneContext?.packRuntime?.update?.({
      camera: activeCamera ?? defaultCamera,
      deltaSeconds,
      renderer,
    });
  }

  renderViewportFrame({
    activeCamera,
    ambientOcclusionEnabled,
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
