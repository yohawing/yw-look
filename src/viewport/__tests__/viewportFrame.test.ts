import {
  Color,
  Line,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  Scene,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  createViewportRuntimeStatsState,
  renderViewportFrame,
  sampleViewportRuntimeStats,
  tickViewportFrame,
} from "../viewportFrame";
import type { ViewportComposerState } from "../fxaa";
import type { SceneContext } from "../../types/viewer";

function makeRenderer() {
  const clearColor = new Color(0x123456);
  let clearAlpha = 0.4;
  return {
    autoClear: true,
    getClearAlpha: vi.fn(() => clearAlpha),
    getClearColor: vi.fn((target: Color) => target.copy(clearColor)),
    info: {
      memory: { geometries: 3, textures: 4 },
      render: { calls: 5, triangles: 1200 },
    },
    render: vi.fn(),
    setClearAlpha: vi.fn((value: number) => {
      clearAlpha = value;
    }),
    setClearColor: vi.fn((value: Color | number) => {
      clearColor.set(value);
    }),
    setRenderTarget: vi.fn(),
  };
}

function makeComposerState(camera: PerspectiveCamera) {
  return {
    composer: {
      dispose: vi.fn(),
      render: vi.fn(),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
    },
    disposed: false,
    failed: false,
    fxaaPass: {
      dispose: vi.fn(),
      enabled: true,
      material: { uniforms: {} },
    },
    outputPass: { dispose: vi.fn() },
    renderPass: { camera },
    ssaoPass: {
      camera,
      depthRenderMaterial: {
        uniforms: {
          cameraFar: { value: camera.far },
          cameraNear: { value: camera.near },
        },
      },
      dispose: vi.fn(),
      enabled: true,
      ssaoMaterial: {
        uniforms: {
          cameraFar: { value: camera.far },
          cameraInverseProjectionMatrix: {
            value: { copy: vi.fn() },
          },
          cameraNear: { value: camera.near },
          cameraProjectionMatrix: { value: { copy: vi.fn() } },
        },
      },
    },
  } as unknown as ViewportComposerState;
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
    const fxaaState = makeComposerState(defaultCamera);

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
    expect(fxaaState.ssaoPass.enabled).toBe(false);
    expect(fxaaState.fxaaPass.enabled).toBe(true);
    expect(fxaaState.composer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(labelRenderer.render).toHaveBeenCalledWith(scene, activeCamera);
  });

  it("renders SSAO through the composer with the active perspective camera", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const activeCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();
    const composerState = makeComposerState(defaultCamera);

    renderViewportFrame({
      activeCamera,
      ambientOcclusionEnabled: true,
      defaultCamera,
      fxaaEnabled: false,
      fxaaState: composerState,
      labelRenderer: labelRenderer as never,
      renderer: renderer as never,
      scene,
    });

    expect(composerState.renderPass.camera).toBe(activeCamera);
    expect(composerState.ssaoPass.camera).toBe(activeCamera);
    expect(composerState.ssaoPass.enabled).toBe(true);
    expect(composerState.fxaaPass.enabled).toBe(false);
    expect(composerState.composer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it("disables AO for an orthographic camera and keeps direct rendering", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const activeCamera = new OrthographicCamera();
    const renderer = makeRenderer();
    const composerState = makeComposerState(defaultCamera);

    renderViewportFrame({
      activeCamera,
      ambientOcclusionEnabled: true,
      defaultCamera,
      fxaaEnabled: false,
      fxaaState: composerState,
      labelRenderer: makeLabelRenderer() as never,
      renderer: renderer as never,
      scene,
    });

    expect(composerState.composer.render).not.toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledWith(scene, activeCamera);
  });

  it("falls back permanently to direct rendering after a composer failure", () => {
    const scene = new Scene();
    const originalOverrideMaterial = new MeshBasicMaterial();
    scene.overrideMaterial = originalOverrideMaterial;
    const points = new Points();
    const line = new Line();
    scene.add(points, line);
    const defaultCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const composerState = makeComposerState(defaultCamera);
    vi.mocked(composerState.composer.render).mockImplementation(() => {
      scene.overrideMaterial = new MeshBasicMaterial();
      renderer.autoClear = false;
      renderer.setClearColor(0xffffff);
      renderer.setClearAlpha(1);
      points.visible = false;
      line.visible = false;
      throw new Error("post-processing failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderViewportFrame({
      activeCamera: null,
      ambientOcclusionEnabled: true,
      defaultCamera,
      fxaaEnabled: true,
      fxaaState: composerState,
      labelRenderer: makeLabelRenderer() as never,
      renderer: renderer as never,
      scene,
    });
    renderViewportFrame({
      activeCamera: null,
      ambientOcclusionEnabled: true,
      defaultCamera,
      fxaaEnabled: true,
      fxaaState: composerState,
      labelRenderer: makeLabelRenderer() as never,
      renderer: renderer as never,
      scene,
    });

    expect(composerState.failed).toBe(true);
    expect(composerState.composer.render).toHaveBeenCalledTimes(1);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(scene.overrideMaterial).toBe(originalOverrideMaterial);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.getClearAlpha()).toBe(0.4);
    expect(renderer.getClearColor(new Color()).getHex()).toBe(0x123456);
    expect(points.visible).toBe(true);
    expect(line.visible).toBe(true);
    warn.mockRestore();
  });

  it("restores renderer and scene state after a successful composer render", () => {
    const scene = new Scene();
    const originalOverrideMaterial = new MeshBasicMaterial();
    scene.overrideMaterial = originalOverrideMaterial;
    const points = new Points();
    const line = new Line();
    scene.add(points, line);
    const defaultCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const composerState = makeComposerState(defaultCamera);
    vi.mocked(composerState.composer.render).mockImplementation(() => {
      scene.overrideMaterial = null;
      renderer.autoClear = false;
      renderer.setClearColor(0xffffff);
      renderer.setClearAlpha(1);
      points.visible = false;
      line.visible = false;
    });

    renderViewportFrame({
      activeCamera: null,
      ambientOcclusionEnabled: true,
      defaultCamera,
      fxaaEnabled: true,
      fxaaState: composerState,
      labelRenderer: makeLabelRenderer() as never,
      renderer: renderer as never,
      scene,
    });

    expect(scene.overrideMaterial).toBe(originalOverrideMaterial);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.getClearAlpha()).toBe(0.4);
    expect(renderer.getClearColor(new Color()).getHex()).toBe(0x123456);
    expect(points.visible).toBe(true);
    expect(line.visible).toBe(true);
    expect(renderer.render).not.toHaveBeenCalled();
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

  it("updates the pack runtime with the active camera before rendering", () => {
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const activeCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();
    const packRuntimeUpdate = vi.fn();
    const sceneContext = {
      sourceObject: null,
      packRuntime: { update: packRuntimeUpdate },
    } as unknown as SceneContext;

    tickViewportFrame({
      activeCamera,
      controls: makeControls() as never,
      defaultCamera,
      flyCameraControls: makeFlyCameraControls(false),
      frameNow: 1016,
      fxaaEnabled: false,
      fxaaState: null,
      labelRenderer: labelRenderer as never,
      previousRenderTimestamp: 1000,
      publishResourceDiagnostics: vi.fn(),
      renderer: renderer as never,
      scene,
      sceneContext,
      statsNode: null,
      statsState: createViewportRuntimeStatsState(1016),
      viewerSurfaceMode: "asset",
    });

    expect(packRuntimeUpdate).toHaveBeenCalledWith({
      camera: activeCamera,
      deltaSeconds: 0.016,
      renderer,
    });
    expect(packRuntimeUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.render.mock.invocationCallOrder[0],
    );
  });

  it("passes the default camera to the pack runtime without an active camera", () => {
    const defaultCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const packRuntimeUpdate = vi.fn();
    const sceneContext = {
      sourceObject: null,
      packRuntime: { update: packRuntimeUpdate },
    } as unknown as SceneContext;

    tickViewportFrame({
      activeCamera: null,
      controls: makeControls() as never,
      defaultCamera,
      flyCameraControls: makeFlyCameraControls(false),
      frameNow: 1016,
      fxaaEnabled: false,
      fxaaState: null,
      labelRenderer: makeLabelRenderer() as never,
      previousRenderTimestamp: 1000,
      publishResourceDiagnostics: vi.fn(),
      renderer: renderer as never,
      scene: new Scene(),
      sceneContext,
      statsNode: null,
      statsState: createViewportRuntimeStatsState(1016),
      viewerSurfaceMode: "asset",
    });

    expect(packRuntimeUpdate).toHaveBeenCalledWith({
      camera: defaultCamera,
      deltaSeconds: 0.016,
      renderer,
    });
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
