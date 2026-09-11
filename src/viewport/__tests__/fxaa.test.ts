import { describe, expect, it, vi } from "vitest";
import { Mesh, MeshBasicMaterial, Scene, Vector2 } from "three";
import type { SceneContext } from "../../types/viewer";
import {
  addViewportComposerPasses,
  createViewportComposerState,
  disposeViewportComposer,
  hideAoIncompatibleMeshes,
  syncViewportComposerSize,
  type ViewportComposerState,
} from "../fxaa";

describe("viewport composer", () => {
  it("updates composer size and FXAA resolution", () => {
    const setSize = vi.fn();
    const setPixelRatio = vi.fn();
    const resolution = new Vector2();
    const state = {
      composer: {
        render: vi.fn(),
        setPixelRatio,
        setSize,
        dispose: vi.fn(),
      },
      fxaaPass: {
        material: {
          uniforms: {
            resolution: { value: resolution },
          },
        },
      },
      renderPass: { camera: {} },
    } as unknown as ViewportComposerState;

    syncViewportComposerSize(state, 200, 100, 2);

    expect(setPixelRatio).toHaveBeenCalledWith(2);
    expect(setSize).toHaveBeenCalledWith(200, 100);
    expect(resolution.x).toBeCloseTo(1 / 400);
    expect(resolution.y).toBeCloseTo(1 / 200);
  });

  it("does not resize post-processing targets to zero", () => {
    const state = {
      composer: { setPixelRatio: vi.fn(), setSize: vi.fn() },
    } as unknown as ViewportComposerState;

    syncViewportComposerSize(state, 0, 100, 2);

    expect(state.composer.setPixelRatio).not.toHaveBeenCalled();
    expect(state.composer.setSize).not.toHaveBeenCalled();
  });

  it("hides transparent and cutout meshes only until restoration", () => {
    const scene = new Scene();
    const opaque = new Mesh(undefined, new MeshBasicMaterial());
    const transparent = new Mesh(
      undefined,
      new MeshBasicMaterial({ transparent: true }),
    );
    const cutout = new Mesh(
      undefined,
      new MeshBasicMaterial({ alphaTest: 0.5 }),
    );
    const alreadyHidden = new Mesh(
      undefined,
      new MeshBasicMaterial({ transparent: true }),
    );
    alreadyHidden.visible = false;
    scene.add(opaque, transparent, cutout, alreadyHidden);

    const restore = hideAoIncompatibleMeshes(scene);

    expect(opaque.visible).toBe(true);
    expect(transparent.visible).toBe(false);
    expect(cutout.visible).toBe(false);
    expect(alreadyHidden.visible).toBe(false);

    restore();

    expect(opaque.visible).toBe(true);
    expect(transparent.visible).toBe(true);
    expect(cutout.visible).toBe(true);
    expect(alreadyHidden.visible).toBe(false);
  });

  it("explicitly disposes every pass and the composer", () => {
    const state = {
      composer: { dispose: vi.fn() },
      disposed: false,
      fxaaPass: { dispose: vi.fn() },
      outputPass: { dispose: vi.fn() },
      ssaoPass: {
        dispose: vi.fn(),
        noiseTexture: { dispose: vi.fn() },
        ssaoMaterial: { dispose: vi.fn() },
      },
    } as unknown as ViewportComposerState;

    disposeViewportComposer(state);
    disposeViewportComposer(state);

    expect(state.ssaoPass.dispose).toHaveBeenCalledTimes(1);
    expect(state.ssaoPass.ssaoMaterial.dispose).toHaveBeenCalledTimes(1);
    expect(state.ssaoPass.noiseTexture.dispose).toHaveBeenCalledTimes(1);
    expect(state.fxaaPass.dispose).toHaveBeenCalledTimes(1);
    expect(state.outputPass.dispose).toHaveBeenCalledTimes(1);
    expect(state.composer.dispose).toHaveBeenCalledTimes(1);
  });

  it("orders output conversion before the final FXAA pass", () => {
    const addPass = vi.fn();
    const passes = {
      renderPass: { name: "render" },
      ssaoPass: { name: "ssao" },
      outputPass: { name: "output" },
      fxaaPass: { name: "fxaa" },
    } as unknown as Pick<
      ViewportComposerState,
      "fxaaPass" | "outputPass" | "renderPass" | "ssaoPass"
    >;

    addViewportComposerPasses({ addPass } as never, passes);

    expect(addPass.mock.calls.map(([pass]) => pass)).toEqual([
      passes.renderPass,
      passes.ssaoPass,
      passes.outputPass,
      passes.fxaaPass,
    ]);
  });

  it("skips composer construction when cancelled after imports", async () => {
    const context = {
      renderer: null,
    } as unknown as SceneContext;

    await expect(
      createViewportComposerState(
        context,
        { clientWidth: 200, clientHeight: 100 },
        { isCancelled: () => true },
      ),
    ).resolves.toBeNull();
  });

  it("returns direct-render fallback state when composer construction fails", async () => {
    const context = {
      renderer: null,
    } as unknown as SceneContext;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      createViewportComposerState(context, {
        clientWidth: 200,
        clientHeight: 100,
      }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[viewer] post-processing unavailable; using direct rendering",
      expect.anything(),
    );

    warn.mockRestore();
  });
});
