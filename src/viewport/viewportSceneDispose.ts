import type {
  AmbientLight,
  DirectionalLight,
  PMREMGenerator,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { FxaaComposerState } from "./fxaa";
import { runCleanupCallbacksSafely } from "./renderSettings";
import {
  resetSceneObjects,
  revokeUrls,
  stopAnimations,
  type SceneContext,
} from "../viewer";
import type { EnvironmentPreset } from "../types/viewer";

type Ref<T> = {
  current: T;
};

type DisposeViewportSceneOptions = {
  ambientLightRef: Ref<AmbientLight | null>;
  clearResourceDiagnostics: () => void;
  controls: { dispose(): void };
  environmentTargetRef: Ref<WebGLRenderTarget | null>;
  environmentTargetsRef: Ref<Map<EnvironmentPreset, WebGLRenderTarget> | null>;
  fillLightRef: Ref<DirectionalLight | null>;
  fxaaStateRef: Ref<FxaaComposerState | null>;
  host: HTMLElement;
  keyLightRef: Ref<DirectionalLight | null>;
  labelRenderer: CSS2DRenderer;
  pmremGenerator: PMREMGenerator;
  renderer: WebGLRenderer;
  resetCameraRef: Ref<(() => void) | null>;
  sceneContextRef: Ref<SceneContext | null>;
};

export function disposeViewportScene({
  ambientLightRef,
  clearResourceDiagnostics,
  controls,
  environmentTargetRef,
  environmentTargetsRef,
  fillLightRef,
  fxaaStateRef,
  host,
  keyLightRef,
  labelRenderer,
  pmremGenerator,
  renderer,
  resetCameraRef,
  sceneContextRef,
}: DisposeViewportSceneOptions): void {
  let firstCleanupError: unknown = null;
  const attemptCleanup = (cleanup: () => void) => {
    try {
      cleanup();
    } catch (error) {
      firstCleanupError ??= error;
    }
  };

  if (sceneContextRef.current) {
    const cleanupError = runCleanupCallbacksSafely(
      sceneContextRef.current.cleanupCallbacks,
    );
    firstCleanupError ??= cleanupError;
    sceneContextRef.current.cleanupCallbacks = [];
    attemptCleanup(() => stopAnimations(sceneContextRef.current!));
    attemptCleanup(() => resetSceneObjects(sceneContextRef.current!));
  }
  attemptCleanup(() => revokeUrls(sceneContextRef.current?.cleanupUrls ?? []));
  controls.dispose();
  environmentTargetsRef.current?.forEach((target) => target.dispose());
  environmentTargetsRef.current?.clear();
  environmentTargetsRef.current = null;
  environmentTargetRef.current = null;
  fxaaStateRef.current?.composer.dispose();
  fxaaStateRef.current = null;
  ambientLightRef.current = null;
  keyLightRef.current = null;
  fillLightRef.current = null;
  pmremGenerator.dispose();
  renderer.dispose();
  host.removeChild(renderer.domElement);
  host.removeChild(labelRenderer.domElement);
  sceneContextRef.current = null;
  resetCameraRef.current = null;
  clearResourceDiagnostics();

  if (firstCleanupError) {
    throw firstCleanupError;
  }
}
