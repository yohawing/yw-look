import { PerspectiveCamera, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  createViewportRuntimeStatsState,
  renderViewportFrame,
  sampleViewportRuntimeStats,
  tickViewportFrame,
} from "../viewportFrame";
import type { FxaaComposerState } from "../fxaa";
import type { SceneContext } from "../../types/viewer";

function makeRenderer() {
  return {
    info: {
      memory: { geometries: 3, textures: 4 },
      render: { calls: 5, triangles: 1200 },
    },
    render: vi.fn(),
  };
}

function makeLabelRenderer() {
  return {
    render: vi.fn(),
  };
}

function makeControls() {
  return {
    update: vi.fn(),
  };
}

function makeFlyCameraControls(isActive: boolean) {
  return {
    update: vi.fn(() => isActive),
  };
}

function makeRuntimePreviewContext(update: ReturnType<typeof vi.fn>) {
  return {
    sourceObject: {
      userData: {
        vrm: {
          update,
        },
      },
    },
  } as unknown as SceneContext;
}

describe("viewportFrame", () => {
  it("renders with the default camera when FXAA is disabled", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const activeCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();

    renderViewportFrame({
      activeCamera: null,
      defaultCamera,
      fxaaEnabled: false,
      fxaaState: null,
      labelRenderer: labelRenderer as never,
      renderer: renderer as never,
      scene,
    });

    expect(renderer.render).toHaveBeenCalledWith(scene, defaultCamera);
    expect(labelRenderer.render).toHaveBeenCalledWith(scene, defaultCamera);
    expect(renderer.render).not.toHaveBeenCalledWith(scene, activeCamera);
  });

  it("renders through FXAA composer with the active camera", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const activeCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();
    const fxaaState = {
      composer: {
        dispose: vi.fn(),
        render: vi.fn(),
        setSize: vi.fn(),
      },
      fxaaPass: {
        material: {
          uniforms: {},
        },
      },
      renderPass: { camera: defaultCamera },
    } as unknown as FxaaComposerState;

    renderViewportFrame({
      activeCamera,
      defaultCamera,
      fxaaEnabled: true,
      fxaaState,
      labelRenderer: labelRenderer as never,
      renderer: renderer as never,
      scene,
    });

    expect(fxaaState.renderPass.camera).toBe(activeCamera);
    expect(fxaaState.composer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(labelRenderer.render).toHaveBeenCalledWith(scene, activeCamera);
  });

  it("samples stats at 250 ms and publishes diagnostics at the resource interval", () => {
    const renderer = makeRenderer();
    const publishResourceDiagnostics = vi.fn();
    const statsNode = document.createElement("div");
    const state = createViewportRuntimeStatsState(1000);

    sampleViewportRuntimeStats({
      now: 1100,
      publishResourceDiagnostics,
      renderer: renderer as never,
      sceneContext: null,
      state,
      statsNode,
    });

    expect(statsNode.textContent).toBe("");
    expect(publishResourceDiagnostics).not.toHaveBeenCalled();

    sampleViewportRuntimeStats({
      now: 3000,
      publishResourceDiagnostics,
      renderer: renderer as never,
      sceneContext: null,
      state,
      statsNode,
    });

    expect(statsNode.textContent).toBe(
      "1 fps  •  5 calls  •  1,200 tri  •  3 geo / 4 tex",
    );
    expect(publishResourceDiagnostics).toHaveBeenCalledWith(null);
  });

  it("ticks orbit controls when fly camera is inactive", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();
    const controls = makeControls();
    const flyCameraControls = makeFlyCameraControls(false);
    const publishResourceDiagnostics = vi.fn();

    const nextTimestamp = tickViewportFrame({
      activeCamera: null,
      controls: controls as never,
      defaultCamera,
      flyCameraControls,
      frameNow: 1016,
      fxaaEnabled: false,
      fxaaState: null,
      labelRenderer: labelRenderer as never,
      previousRenderTimestamp: 1000,
      publishResourceDiagnostics,
      renderer: renderer as never,
      scene,
      sceneContext: null,
      statsNode: null,
      statsState: createViewportRuntimeStatsState(1016),
      viewerSurfaceMode: "asset",
    });

    expect(nextTimestamp).toBe(1016);
    expect(flyCameraControls.update).toHaveBeenCalledWith(1016);
    expect(controls.update).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith(scene, defaultCamera);
  });

  it("skips orbit controls when fly camera handles the frame", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();
    const controls = makeControls();
    const flyCameraControls = makeFlyCameraControls(true);

    tickViewportFrame({
      activeCamera: null,
      controls: controls as never,
      defaultCamera,
      flyCameraControls,
      frameNow: 1016,
      fxaaEnabled: false,
      fxaaState: null,
      labelRenderer: labelRenderer as never,
      previousRenderTimestamp: 1000,
      publishResourceDiagnostics: vi.fn(),
      renderer: renderer as never,
      scene,
      sceneContext: null,
      statsNode: null,
      statsState: createViewportRuntimeStatsState(1016),
      viewerSurfaceMode: "asset",
    });

    expect(flyCameraControls.update).toHaveBeenCalledWith(1016);
    expect(controls.update).not.toHaveBeenCalled();
  });

  it("updates runtime preview in asset mode with clamped delta", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();
    const runtimeUpdate = vi.fn();
    const sceneContext = makeRuntimePreviewContext(runtimeUpdate);

    tickViewportFrame({
      activeCamera: null,
      controls: makeControls() as never,
      defaultCamera,
      flyCameraControls: makeFlyCameraControls(false),
      frameNow: 1500,
      fxaaEnabled: false,
      fxaaState: null,
      labelRenderer: labelRenderer as never,
      previousRenderTimestamp: 1000,
      publishResourceDiagnostics: vi.fn(),
      renderer: renderer as never,
      scene,
      sceneContext,
      statsNode: null,
      statsState: createViewportRuntimeStatsState(1500),
      viewerSurfaceMode: "asset",
    });

    expect(runtimeUpdate).toHaveBeenCalledWith(0.1);
  });

  it("skips runtime preview in texture mode but still samples stats", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();
    const runtimeUpdate = vi.fn();
    const sceneContext = makeRuntimePreviewContext(runtimeUpdate);
    const publishResourceDiagnostics = vi.fn();

    tickViewportFrame({
      activeCamera: null,
      controls: makeControls() as never,
      defaultCamera,
      flyCameraControls: makeFlyCameraControls(false),
      frameNow: 3000,
      fxaaEnabled: false,
      fxaaState: null,
      labelRenderer: labelRenderer as never,
      previousRenderTimestamp: 2990,
      publishResourceDiagnostics,
      renderer: renderer as never,
      scene,
      sceneContext,
      statsNode: null,
      statsState: createViewportRuntimeStatsState(0),
      viewerSurfaceMode: "texture",
    });

    expect(runtimeUpdate).not.toHaveBeenCalled();
    expect(publishResourceDiagnostics).toHaveBeenCalledWith(sceneContext);
  });
});
