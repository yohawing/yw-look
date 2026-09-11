import {
  PerspectiveCamera,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { ViewportComposerState } from "./fxaa";
import { syncViewportComposerSize } from "./fxaa";
import { frameMountedObject, syncPerspectiveCameraAspect } from "./camera";
import { renderViewportFrame } from "./viewportFrame";
import type { SceneContext, ViewerSurfaceMode } from "../types/viewer";

type ViewportResizeHost = Pick<HTMLElement, "clientWidth" | "clientHeight">;

type ApplyViewportResizeOptions = {
  activeCamera: Camera | null;
  ambientOcclusionEnabled?: boolean;
  cameraSpeedMultiplier: number;
  defaultCamera: PerspectiveCamera;
  fxaaEnabled: boolean;
  fxaaState: ViewportComposerState | null;
  host: ViewportResizeHost;
  labelRenderer: CSS2DRenderer;
  renderer: WebGLRenderer;
  scene: Scene;
  sceneContext: SceneContext | null;
  showAxes: boolean;
  showGrid: boolean;
  texturePreview3D: boolean;
  viewerSurfaceMode: ViewerSurfaceMode;
};

export function applyViewportResize({
  activeCamera,
  ambientOcclusionEnabled = false,
  cameraSpeedMultiplier,
  defaultCamera,
  fxaaEnabled,
  fxaaState,
  host,
  labelRenderer,
  renderer,
  scene,
  sceneContext,
  showAxes,
  showGrid,
  texturePreview3D,
  viewerSurfaceMode,
}: ApplyViewportResizeOptions): void {
  const width = host.clientWidth;
  const height = host.clientHeight;

  if (width <= 0 || height <= 0) return;

  renderer.setSize(width, height);
  labelRenderer.setSize(width, height);
  defaultCamera.aspect = width / height;
  defaultCamera.updateProjectionMatrix();

  if (activeCamera instanceof PerspectiveCamera) {
    syncPerspectiveCameraAspect(activeCamera, host);
  }

  if (fxaaState) {
    syncViewportComposerSize(
      fxaaState,
      width,
      height,
      renderer.getPixelRatio(),
    );
  }

  const mountedObject = sceneContext?.mountedObject;
  if (sceneContext && mountedObject && viewerSurfaceMode === "texture") {
    frameMountedObject(
      sceneContext,
      mountedObject,
      viewerSurfaceMode,
      showGrid,
      showAxes,
      cameraSpeedMultiplier,
      undefined,
      texturePreview3D,
    );
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
}
