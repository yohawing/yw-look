import type { Camera, Vector2 } from "three";
import type { SceneContext } from "../types/viewer";

export type FxaaComposerState = {
  composer: {
    render: () => void;
    setSize: (w: number, h: number) => void;
    dispose: () => void;
  };
  fxaaPass: {
    material: {
      uniforms: Record<string, { value: Vector2 }>;
    };
  };
  /** The RenderPass stored so its `.camera` can be swapped when a
   * USD camera is selected (#34). EffectComposer exposes `passes[]`
   * but the typed shape is opaque here; we hold it separately. */
  renderPass: { camera: Camera };
};

type FxaaHost = Pick<HTMLElement, "clientWidth" | "clientHeight">;

type CreateFxaaComposerStateOptions = {
  isCancelled?: () => boolean;
};

export function syncFxaaComposerSize(
  state: FxaaComposerState,
  width: number,
  height: number,
  pixelRatio: number,
) {
  state.composer.setSize(width, height);
  state.fxaaPass.material.uniforms.resolution.value.set(
    1 / (width * pixelRatio),
    1 / (height * pixelRatio),
  );
}

export async function createFxaaComposerState(
  context: SceneContext,
  host: FxaaHost,
  options: CreateFxaaComposerStateOptions = {},
): Promise<FxaaComposerState | null> {
  const [{ EffectComposer }, { RenderPass }, { ShaderPass }, { FXAAShader }] =
    await Promise.all([
      import("three/examples/jsm/postprocessing/EffectComposer.js"),
      import("three/examples/jsm/postprocessing/RenderPass.js"),
      import("three/examples/jsm/postprocessing/ShaderPass.js"),
      import("three/examples/jsm/shaders/FXAAShader.js"),
    ]);

  if (options.isCancelled?.()) {
    return null;
  }

  const composer = new EffectComposer(context.renderer);
  const renderPass = new RenderPass(context.scene, context.camera);
  composer.addPass(renderPass);

  const fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);

  const state = {
    composer,
    fxaaPass: fxaaPass as unknown as FxaaComposerState["fxaaPass"],
    renderPass,
  };
  syncFxaaComposerSize(
    state,
    host.clientWidth,
    host.clientHeight,
    context.renderer.getPixelRatio(),
  );
  return state;
}
