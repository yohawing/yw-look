import type { Camera, Material, Object3D, Scene, Vector2 } from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import type { SceneContext } from "../types/viewer";

export type ViewportComposerState = {
  composer: EffectComposer;
  disposed: boolean;
  fxaaPass: ShaderPass;
  outputPass: OutputPass;
  renderPass: RenderPass;
  ssaoPass: SSAOPass;
  failed: boolean;
};

/** @deprecated Use ViewportComposerState. */
export type FxaaComposerState = ViewportComposerState;

type FxaaHost = Pick<HTMLElement, "clientWidth" | "clientHeight">;

type CreateViewportComposerStateOptions = {
  isCancelled?: () => boolean;
};

function materialsOf(object: Object3D): readonly Material[] {
  const material = (object as Object3D & { material?: Material | Material[] })
    .material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function isAoIncompatibleMaterial(material: Material) {
  return (
    material.transparent ||
    material.opacity < 1 ||
    material.alphaHash ||
    ("alphaTest" in material && Number(material.alphaTest) > 0)
  );
}

/** Hide alpha surfaces only while SSAO builds its opaque normal/depth pass. */
export function hideAoIncompatibleMeshes(scene: Scene): () => void {
  const hidden: Object3D[] = [];
  scene.traverse((object) => {
    if (
      object.visible &&
      (object as Object3D & { isMesh?: boolean }).isMesh === true &&
      materialsOf(object).some(isAoIncompatibleMaterial)
    ) {
      object.visible = false;
      hidden.push(object);
    }
  });

  return () => {
    for (const object of hidden) object.visible = true;
  };
}

export function syncViewportComposerSize(
  state: ViewportComposerState,
  width: number,
  height: number,
  pixelRatio: number,
) {
  if (width <= 0 || height <= 0 || pixelRatio <= 0) return;
  state.composer.setPixelRatio(pixelRatio);
  state.composer.setSize(width, height);
  const resolution = state.fxaaPass.material.uniforms.resolution as {
    value: Vector2;
  };
  resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
}

export function syncViewportComposerCamera(
  state: ViewportComposerState,
  camera: Camera,
) {
  state.renderPass.camera = camera;
  state.ssaoPass.camera = camera;

  const projectionCamera = camera as Camera & {
    far: number;
    near: number;
    projectionMatrix: { copy: (source: unknown) => unknown };
    projectionMatrixInverse: { copy: (source: unknown) => unknown };
  };
  const uniforms = state.ssaoPass.ssaoMaterial.uniforms;
  uniforms.cameraNear.value = projectionCamera.near;
  uniforms.cameraFar.value = projectionCamera.far;
  uniforms.cameraProjectionMatrix.value.copy(projectionCamera.projectionMatrix);
  uniforms.cameraInverseProjectionMatrix.value.copy(
    projectionCamera.projectionMatrixInverse,
  );
  state.ssaoPass.depthRenderMaterial.uniforms.cameraNear.value =
    projectionCamera.near;
  state.ssaoPass.depthRenderMaterial.uniforms.cameraFar.value =
    projectionCamera.far;
}

export function disposeViewportComposer(state: ViewportComposerState) {
  if (state.disposed) return;
  state.disposed = true;
  // EffectComposer does not own the resources allocated by added passes.
  disposeSsaoPass(state.ssaoPass);
  state.fxaaPass.dispose();
  state.outputPass.dispose();
  state.composer.dispose();
}

function disposeSsaoPass(pass: SSAOPass) {
  pass.dispose();
  // three r185's SSAOPass.dispose() omits these two allocations. Material and
  // Texture disposal is safe if a later Three revision also releases them.
  pass.ssaoMaterial.dispose();
  pass.noiseTexture.dispose();
}

export function addViewportComposerPasses(
  composer: Pick<EffectComposer, "addPass">,
  passes: Pick<
    ViewportComposerState,
    "fxaaPass" | "outputPass" | "renderPass" | "ssaoPass"
  >,
) {
  composer.addPass(passes.renderPass);
  composer.addPass(passes.ssaoPass);
  composer.addPass(passes.outputPass);
  composer.addPass(passes.fxaaPass);
}

export async function createViewportComposerState(
  context: SceneContext,
  host: FxaaHost,
  options: CreateViewportComposerStateOptions = {},
): Promise<ViewportComposerState | null> {
  let state: ViewportComposerState | null = null;
  let composer: EffectComposer | null = null;
  let ssaoPass: SSAOPass | null = null;
  let fxaaPass: ShaderPass | null = null;
  let outputPass: OutputPass | null = null;
  try {
    const [
      { EffectComposer },
      { RenderPass },
      { SSAOPass },
      { ShaderPass },
      { OutputPass },
      { FXAAShader },
    ] = await Promise.all([
      import("three/examples/jsm/postprocessing/EffectComposer.js"),
      import("three/examples/jsm/postprocessing/RenderPass.js"),
      import("three/examples/jsm/postprocessing/SSAOPass.js"),
      import("three/examples/jsm/postprocessing/ShaderPass.js"),
      import("three/examples/jsm/postprocessing/OutputPass.js"),
      import("three/examples/jsm/shaders/FXAAShader.js"),
    ]);

    if (options.isCancelled?.()) return null;

    composer = new EffectComposer(context.renderer);
    const renderPass = new RenderPass(context.scene, context.camera);

    ssaoPass = new SSAOPass(
      context.scene,
      context.camera,
      Math.max(1, host.clientWidth),
      Math.max(1, host.clientHeight),
      8,
    );
    ssaoPass.kernelRadius = 0.12;
    ssaoPass.minDistance = 0.001;
    ssaoPass.maxDistance = 0.025;
    const renderSsao = ssaoPass.render.bind(ssaoPass);
    ssaoPass.render = (...args: Parameters<SSAOPass["render"]>) => {
      const restore = hideAoIncompatibleMeshes(context.scene);
      try {
        renderSsao(...args);
      } finally {
        restore();
      }
    };
    fxaaPass = new ShaderPass(FXAAShader);
    outputPass = new OutputPass();
    addViewportComposerPasses(composer, {
      fxaaPass,
      outputPass,
      renderPass,
      ssaoPass,
    });

    state = {
      composer,
      disposed: false,
      failed: false,
      fxaaPass,
      outputPass,
      renderPass,
      ssaoPass,
    };
    syncViewportComposerSize(
      state,
      host.clientWidth,
      host.clientHeight,
      context.renderer.getPixelRatio(),
    );
    return state;
  } catch (error) {
    if (state) {
      disposeViewportComposer(state);
    } else {
      if (ssaoPass) disposeSsaoPass(ssaoPass);
      fxaaPass?.dispose();
      outputPass?.dispose();
      composer?.dispose();
    }
    console.warn(
      "[viewer] post-processing unavailable; using direct rendering",
      error,
    );
    return null;
  }
}

/** @deprecated Use syncViewportComposerSize. */
export const syncFxaaComposerSize = syncViewportComposerSize;
/** @deprecated Use createViewportComposerState. */
export const createFxaaComposerState = createViewportComposerState;
