import { PerspectiveCamera, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import type { FxaaComposerState } from "../fxaa";
import { applyViewportResize } from "../viewportResize";

function makeHost(width: number, height: number) {
  return {
    clientWidth: width,
    clientHeight: height,
  };
}

function makeRenderer(pixelRatio = 1) {
  return {
    getPixelRatio: vi.fn(() => pixelRatio),
    render: vi.fn(),
    setSize: vi.fn(),
  };
}

function makeLabelRenderer() {
  return {
    render: vi.fn(),
    setSize: vi.fn(),
  };
}

function makeFxaaState(camera: PerspectiveCamera) {
  return {
    composer: {
      dispose: vi.fn(),
      render: vi.fn(),
      setSize: vi.fn(),
    },
    fxaaPass: {
      material: {
        uniforms: {
          resolution: {
            value: {
              set: vi.fn(),
            },
          },
        },
      },
    },
    renderPass: { camera },
  } as unknown as FxaaComposerState;
}

describe("applyViewportResize", () => {
  it("resizes render targets, updates cameras, and renders immediately", () => {
    const host = makeHost(800, 400);
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const activeCamera = new PerspectiveCamera();
    const renderer = makeRenderer();
    const labelRenderer = makeLabelRenderer();

    applyViewportResize({
      activeCamera,
      cameraSpeedMultiplier: 1,
      defaultCamera,
      fxaaEnabled: false,
      fxaaState: null,
      host,
      labelRenderer: labelRenderer as never,
      renderer: renderer as never,
      scene,
      sceneContext: null,
      showAxes: true,
      showGrid: true,
      texturePreview3D: false,
      viewerSurfaceMode: "asset",
    });

    expect(renderer.setSize).toHaveBeenCalledWith(800, 400);
    expect(labelRenderer.setSize).toHaveBeenCalledWith(800, 400);
    expect(defaultCamera.aspect).toBe(2);
    expect(activeCamera.aspect).toBe(2);
    expect(renderer.render).toHaveBeenCalledWith(scene, activeCamera);
    expect(labelRenderer.render).toHaveBeenCalledWith(scene, activeCamera);
  });

  it("syncs FXAA size when a composer state exists", () => {
    const host = makeHost(800, 600);
    const scene = new Scene();
    const defaultCamera = new PerspectiveCamera();
    const renderer = makeRenderer(2);
    const labelRenderer = makeLabelRenderer();
    const fxaaState = makeFxaaState(defaultCamera);

    applyViewportResize({
      activeCamera: null,
      cameraSpeedMultiplier: 1,
      defaultCamera,
      fxaaEnabled: false,
      fxaaState,
      host,
      labelRenderer: labelRenderer as never,
      renderer: renderer as never,
      scene,
      sceneContext: null,
      showAxes: true,
      showGrid: true,
      texturePreview3D: false,
      viewerSurfaceMode: "asset",
    });

    expect(fxaaState.composer.setSize).toHaveBeenCalledWith(800, 600);
    expect(
      fxaaState.fxaaPass.material.uniforms.resolution.value.set,
    ).toHaveBeenCalledWith(1 / 1600, 1 / 1200);
    expect(renderer.render).toHaveBeenCalledWith(scene, defaultCamera);
  });
});
