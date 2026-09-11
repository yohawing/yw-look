import { beforeEach, describe, expect, it, vi } from "vitest";
import { disposeViewportScene } from "../viewportSceneDispose";
import type { FxaaComposerState } from "../fxaa";
import type { SceneContext } from "../../types/viewer";

const viewerMocks = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    resetSceneObjects: vi.fn(() => {
      order.push("resetSceneObjects");
    }),
    revokeUrls: vi.fn(() => {
      order.push("revokeUrls");
    }),
    stopAnimations: vi.fn(() => {
      order.push("stopAnimations");
    }),
  };
});

vi.mock("../../viewer", () => ({
  resetSceneObjects: viewerMocks.resetSceneObjects,
  revokeUrls: viewerMocks.revokeUrls,
  stopAnimations: viewerMocks.stopAnimations,
}));

function ref<T>(current: T) {
  return { current };
}

function createSceneContext() {
  return {
    cleanupCallbacks: [
      () => {
        viewerMocks.order.push("cleanupCallback");
      },
    ],
    cleanupUrls: ["blob:a", "blob:b"],
  } as unknown as SceneContext;
}

function createDisposalHarness(sceneContext: SceneContext | null) {
  const host = document.createElement("div");
  const rendererDomElement = document.createElement("canvas");
  const labelDomElement = document.createElement("div");
  host.append(rendererDomElement, labelDomElement);
  const renderer = {
    dispose: vi.fn(() => {
      viewerMocks.order.push("renderer.dispose");
    }),
    domElement: rendererDomElement,
  };
  const labelRenderer = {
    domElement: labelDomElement,
  };
  const controls = {
    dispose: vi.fn(() => {
      viewerMocks.order.push("controls.dispose");
    }),
  };
  const pmremGenerator = {
    dispose: vi.fn(() => {
      viewerMocks.order.push("pmrem.dispose");
    }),
  };
  const environmentTarget = {
    dispose: vi.fn(() => {
      viewerMocks.order.push("environmentTarget.dispose");
    }),
  };
  const environmentTargets = new Map([["studio", environmentTarget]]);
  const fxaaState = {
    composer: {
      dispose: vi.fn(() => {
        viewerMocks.order.push("fxaa.dispose");
      }),
    },
  } as unknown as FxaaComposerState;

  return {
    ambientLightRef: ref({}),
    clearResourceDiagnostics: vi.fn(() => {
      viewerMocks.order.push("clearResourceDiagnostics");
    }),
    controls,
    environmentTarget,
    environmentTargetRef: ref(environmentTarget),
    environmentTargets,
    environmentTargetsRef: ref(environmentTargets),
    fillLightRef: ref({}),
    fxaaState,
    fxaaStateRef: ref<FxaaComposerState | null>(fxaaState),
    host,
    keyLightRef: ref({}),
    labelRenderer,
    pmremGenerator,
    renderer,
    resetCameraRef: ref(() => undefined),
    sceneContext,
    sceneContextRef: ref(sceneContext),
  };
}

describe("disposeViewportScene", () => {
  it("disposes every cached preset even when None is active at shutdown", () => {
    const harness = createDisposalHarness(null);
    const neutral = { dispose: vi.fn() };
    const outdoor = { dispose: vi.fn() };
    harness.environmentTargets.set("neutral", neutral);
    harness.environmentTargets.set("outdoor", outdoor);
    harness.environmentTargetRef.current = null as never;
    disposeViewportScene(
      harness as unknown as Parameters<typeof disposeViewportScene>[0],
    );
    expect(harness.environmentTarget.dispose).toHaveBeenCalledTimes(1);
    expect(neutral.dispose).toHaveBeenCalledTimes(1);
    expect(outdoor.dispose).toHaveBeenCalledTimes(1);
    expect(harness.environmentTargets.size).toBe(0);
    expect(harness.environmentTargetsRef.current).toBeNull();
  });
  beforeEach(() => {
    viewerMocks.order.length = 0;
    viewerMocks.resetSceneObjects.mockClear();
    viewerMocks.revokeUrls.mockClear();
    viewerMocks.stopAnimations.mockClear();
  });

  it("runs scene cleanup before disposal and clears refs", () => {
    const sceneContext = createSceneContext();
    const harness = createDisposalHarness(sceneContext);

    disposeViewportScene({
      ambientLightRef: harness.ambientLightRef as never,
      clearResourceDiagnostics: harness.clearResourceDiagnostics,
      controls: harness.controls,
      environmentTargetRef: harness.environmentTargetRef as never,
      environmentTargetsRef: harness.environmentTargetsRef as never,
      fillLightRef: harness.fillLightRef as never,
      fxaaStateRef: harness.fxaaStateRef,
      host: harness.host,
      keyLightRef: harness.keyLightRef as never,
      labelRenderer: harness.labelRenderer as never,
      pmremGenerator: harness.pmremGenerator as never,
      renderer: harness.renderer as never,
      resetCameraRef: harness.resetCameraRef,
      sceneContextRef: harness.sceneContextRef,
    });

    expect(viewerMocks.order).toEqual([
      "cleanupCallback",
      "stopAnimations",
      "resetSceneObjects",
      "revokeUrls",
      "controls.dispose",
      "environmentTarget.dispose",
      "fxaa.dispose",
      "pmrem.dispose",
      "renderer.dispose",
      "clearResourceDiagnostics",
    ]);
    expect(sceneContext.cleanupCallbacks).toEqual([]);
    expect(viewerMocks.revokeUrls).toHaveBeenCalledWith(["blob:a", "blob:b"]);
    expect(harness.controls.dispose).toHaveBeenCalledTimes(1);
    expect(harness.environmentTarget.dispose).toHaveBeenCalledTimes(1);
    expect(harness.environmentTargets.size).toBe(0);
    expect(harness.environmentTargetsRef.current).toBeNull();
    expect(harness.environmentTargetRef.current).toBeNull();
    expect(harness.fxaaState.composer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.fxaaStateRef.current).toBeNull();
    expect(harness.ambientLightRef.current).toBeNull();
    expect(harness.keyLightRef.current).toBeNull();
    expect(harness.fillLightRef.current).toBeNull();
    expect(harness.pmremGenerator.dispose).toHaveBeenCalledTimes(1);
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.host.children).toHaveLength(0);
    expect(harness.sceneContextRef.current).toBeNull();
    expect(harness.resetCameraRef.current).toBeNull();
    expect(harness.clearResourceDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("revokes an empty URL list when the scene context is already null", () => {
    const harness = createDisposalHarness(null);
    harness.fxaaStateRef.current = null;

    disposeViewportScene({
      ambientLightRef: harness.ambientLightRef as never,
      clearResourceDiagnostics: harness.clearResourceDiagnostics,
      controls: harness.controls,
      environmentTargetRef: harness.environmentTargetRef as never,
      environmentTargetsRef: harness.environmentTargetsRef as never,
      fillLightRef: harness.fillLightRef as never,
      fxaaStateRef: harness.fxaaStateRef,
      host: harness.host,
      keyLightRef: harness.keyLightRef as never,
      labelRenderer: harness.labelRenderer as never,
      pmremGenerator: harness.pmremGenerator as never,
      renderer: harness.renderer as never,
      resetCameraRef: harness.resetCameraRef,
      sceneContextRef: harness.sceneContextRef,
    });

    expect(viewerMocks.stopAnimations).not.toHaveBeenCalled();
    expect(viewerMocks.resetSceneObjects).not.toHaveBeenCalled();
    expect(viewerMocks.revokeUrls).toHaveBeenCalledWith([]);
    expect(harness.fxaaState.composer.dispose).not.toHaveBeenCalled();
    expect(harness.fxaaStateRef.current).toBeNull();
    expect(harness.sceneContextRef.current).toBeNull();
    expect(harness.clearResourceDiagnostics).toHaveBeenCalledTimes(1);
  });
});
