import { invoke } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
import { errorMessage } from "../lib/errors";
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  DirectionalLight,
  Group,
  Line,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { resolveSelectedFile } from "../lib/files";
import {
  collectAssetIssues,
  deferredSummaryHasNoRenderableGeometry,
  inspectStage,
  inspectionHasDeferredPayloads,
  summarizeStage,
  type StageInspection,
  type StageLoadPolicy,
  type StageSummary,
} from "../lib/usd";
import {
  captureRendererScreenshot,
  disposeObject,
  getPreviewRenderingPresetForExtension,
  isRendererCanvasNonBlank,
  loadMmdMotion,
  loadPreviewObject,
  MMD_EXAMPLE_LIGHTING_PRESET,
  MMD_PREVIEW_RENDERING_PRESET,
  normalizeObjectScale,
  getScaleWarning,
  applyPreviewRenderingPreset,
  revokeUrls,
  type SceneContext,
} from "../viewer";
import { createMmdRuntime, syncMmdPreviewSpecularDirection } from "../packs";
import type { MmdRuntimeModelHandle } from "../types/viewer";

export type ShotMode = "shot" | "check";

export type ShotConfig = {
  caseIndex: number;
  mode: ShotMode;
  inputPath: string;
  fileName: string;
  extension: string;
  motionPath: string | null;
  morphWeights: number[];
  width: number;
  height: number;
  background: string | null;
  usdLoadPolicy: StageLoadPolicy;
};

export type ShotOutcome = {
  loaded: boolean;
  nonBlankCanvas: boolean;
  meshCount: number;
  loadTimeMs: number;
  outputPath: string | null;
  warnings: string[];
  error: string | null;
};

const DEFAULT_BG = "#111318";
const USD_EXTENSIONS = new Set(["usd", "usda", "usdc", "usdz"]);
const DEFAULT_CAMERA_POSITION = new Vector3(5, 4, 5);
const DEFAULT_CAMERA_TARGET = new Vector3(0, 0, 0);

export async function loadShotConfig() {
  return invoke<ShotConfig | null>("get_shot_config");
}

export async function loadShotBatchConfig() {
  return invoke<ShotConfig[]>("get_shot_batch_config");
}

export async function finishShotRun(
  exitCode: number,
  message?: string | null,
  outcome?: ShotOutcome | null,
) {
  await invoke("finish_shot_run", {
    exitCode,
    message: message ?? null,
    outcome: outcome ?? null,
  });
}

export async function writeShotOutput(dataUrl: string, caseIndex?: number) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (caseIndex !== undefined) {
    return invoke<string>("write_shot_batch_output", {
      caseIndex,
      pngBytes: Array.from(bytes),
    });
  }
  return invoke<string>("write_shot_output", {
    pngBytes: Array.from(bytes),
  });
}

function parseBackground(value: string | null) {
  if (!value || value === "default") {
    return { color: DEFAULT_BG, alpha: false };
  }
  if (value === "transparent") {
    return { color: "#000000", alpha: true };
  }
  return { color: value, alpha: false };
}

function createRenderer(
  width: number,
  height: number,
  background: string | null,
  extension: string,
) {
  const bg = parseBackground(background);
  const renderingPreset = getPreviewRenderingPresetForExtension(extension);
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: bg.alpha,
    logarithmicDepthBuffer: renderingPreset.logarithmicDepthBuffer,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  if (renderingPreset === MMD_PREVIEW_RENDERING_PRESET) {
    applyPreviewRenderingPreset(renderer, renderingPreset);
  }
  if (bg.alpha) {
    renderer.setClearColor("#000000", 0);
  } else {
    renderer.setClearColor(bg.color);
  }
  return renderer;
}

function setupScene(width: number, height: number) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, width / height, 0.01, 1000);
  scene.add(new AmbientLight("#ffffff", 1.4));
  const key = new DirectionalLight("#ffffff", 2.2);
  key.position.set(3, 6, 4);
  scene.add(key);
  return { scene, camera, key };
}

function applyShotMmdLighting(scene: Scene, key: DirectionalLight) {
  for (const child of scene.children) {
    if (child instanceof AmbientLight) {
      child.intensity = MMD_EXAMPLE_LIGHTING_PRESET.ambientIntensity;
    }
  }
  key.intensity = MMD_EXAMPLE_LIGHTING_PRESET.keyIntensity;
  key.position.set(...MMD_EXAMPLE_LIGHTING_PRESET.keyPosition);
}

function readVector3UserData(value: unknown) {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  const [x, y, z] = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return null;
  }
  return new Vector3(x, y, z);
}

function readPositiveNumberUserData(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function frameObject(camera: PerspectiveCamera, object: Group | Mesh) {
  if (object.userData?.disableAutoFrame) {
    const splatCenter = readVector3UserData(object.userData.splatBoundsCenter);
    const splatMaxDimension = readPositiveNumberUserData(
      object.userData.splatBoundsMaxDimension,
    );
    if (splatCenter && splatMaxDimension) {
      const fitHeightDistance =
        splatMaxDimension / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const distance = fitHeightDistance * 1.55;
      camera.position.copy(
        splatCenter
          .clone()
          .add(
            new Vector3(1.1, 0.75, 1.1).normalize().multiplyScalar(distance),
          ),
      );
      camera.near = Math.max(splatMaxDimension / 500, 0.01);
      camera.far = Math.max(splatMaxDimension * 20, 200);
      camera.lookAt(splatCenter);
      camera.updateProjectionMatrix();
      return;
    }

    camera.position.copy(DEFAULT_CAMERA_POSITION);
    camera.near = 0.01;
    camera.far = 100_000;
    camera.lookAt(DEFAULT_CAMERA_TARGET);
    camera.updateProjectionMatrix();
    return;
  }

  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const fitHeightDistance =
    maxDimension / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const distance = fitHeightDistance * 1.55;
  camera.position.copy(
    center
      .clone()
      .add(new Vector3(1.1, 0.75, 1.1).normalize().multiplyScalar(distance)),
  );
  camera.near = Math.max(maxDimension / 500, 0.01);
  camera.far = Math.max(maxDimension * 20, 200);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

function countMeshes(object: Group | Mesh) {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof Mesh) {
      count += 1;
    }
  });
  return count;
}

function countRenderableObjects(object: Group | Mesh) {
  let count = 0;
  object.traverse((child) => {
    if (
      child instanceof Mesh ||
      child instanceof Points ||
      child instanceof Line ||
      child instanceof LineSegments
    ) {
      count += 1;
    }
  });
  return count;
}

function runShotCleanupCallbacks(callbacks: Array<() => void>) {
  for (const cleanup of callbacks.splice(0)) {
    try {
      cleanup();
    } catch {
      // Cleanup must not replace the shot/check outcome.
    }
  }
}

export function applyShotMorphWeights(
  model: MmdRuntimeModelHandle | undefined,
  weights: readonly number[],
) {
  if (weights.length === 0) return;
  if (!model) {
    throw new Error("Morph weights require a loaded MMD model.");
  }
  const mesh = model.mesh as Mesh;
  const influences = mesh.morphTargetInfluences ?? [];
  while (influences.length < weights.length) influences.push(0);
  weights.forEach((weight, index) => {
    if (!Number.isFinite(weight)) {
      throw new Error(`Morph weight ${index} must be finite.`);
    }
    influences[index] = weight;
  });
  mesh.morphTargetInfluences = influences;
  model.syncMaterialMorphs?.();
}

async function validateUsdInspection(path: string, policy: StageLoadPolicy) {
  const [summary, inspection] = await Promise.all([
    summarizeStage(path, policy),
    inspectStage(path, policy),
  ]);
  const missingAssetDetails =
    inspection.missingAssets.length > 0
      ? `: ${inspection.missingAssets.join(", ")}`
      : ".";

  if (summary.unresolvedReferenceCount > 0) {
    throw new Error(
      `USD inspection found ${summary.unresolvedReferenceCount} unresolved reference(s) under ${policy}${missingAssetDetails}`,
    );
  }
  if (policy === "loadAll" && summary.unresolvedPayloadCount > 0) {
    throw new Error(
      `USD inspection found ${summary.unresolvedPayloadCount} unresolved payload(s) under ${policy}${missingAssetDetails}`,
    );
  }
  if (policy === "loadAll" && inspection.missingAssets.length > 0) {
    throw new Error(
      `USD inspection found missing asset(s) under ${policy}: ${inspection.missingAssets.join(", ")}`,
    );
  }
}

async function validateUsdInspectorPipeline(
  path: string,
  extension: string,
  policy: StageLoadPolicy,
) {
  if (!USD_EXTENSIONS.has(extension)) {
    return;
  }

  try {
    await validateUsdInspection(path, policy);
    if (policy === "loadAll") {
      await validateUsdInspection(path, "noPayloads");
      const issues = await collectAssetIssues(path);
      const errors = issues.filter((issue) => issue.level === "error");
      if (errors.length > 0) {
        throw new Error(
          `USD asset issue(s): ${errors.map((issue) => issue.message).join("; ")}`,
        );
      }
    }
  } catch (error) {
    throw new Error(
      `USD inspector validation failed: ${errorMessage(error, "unknown inspector error")}`,
      { cause: error },
    );
  }
}

export function isDeferredUsdEmptyCheckOutcome(
  extension: string,
  policy: StageLoadPolicy,
  summary: Pick<StageSummary, "totalVertices" | "unloadedPayloadCount">,
  inspection: Pick<StageInspection, "payloads">,
) {
  if (!USD_EXTENSIONS.has(extension) || policy !== "noPayloads") {
    return false;
  }
  return (
    deferredSummaryHasNoRenderableGeometry(summary) &&
    inspectionHasDeferredPayloads(inspection)
  );
}

async function isDeferredUsdEmptyCheckResult(
  path: string,
  extension: string,
  policy: StageLoadPolicy,
) {
  if (!USD_EXTENSIONS.has(extension) || policy !== "noPayloads") {
    return false;
  }
  const [summary, inspection] = await Promise.all([
    summarizeStage(path, policy),
    inspectStage(path, policy),
  ]);
  return isDeferredUsdEmptyCheckOutcome(extension, policy, summary, inspection);
}

function waitFrame() {
  return new Promise<void>((resolve) => setTimeout(resolve, 16));
}

async function settleFrames(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  frames: number,
) {
  for (let index = 0; index < frames; index += 1) {
    await waitFrame();
    renderer.render(scene, camera);
  }
}

async function updateSparkRenderers(scene: Scene, camera: PerspectiveCamera) {
  const updates: Array<Promise<void>> = [];
  scene.traverse((child) => {
    const update = (child as { update?: unknown }).update;
    if (
      child.userData?.ywSparkRenderer === true &&
      typeof update === "function"
    ) {
      updates.push(
        Promise.resolve(
          update.call(child, {
            scene,
            camera,
          }),
        ),
      );
    }
  });
  await Promise.all(updates);
}

export async function runShot(
  config: ShotConfig,
  writeOutput: (
    dataUrl: string,
    caseIndex: number,
  ) => Promise<string> = writeShotOutput,
): Promise<ShotOutcome> {
  const renderer = createRenderer(
    config.width,
    config.height,
    config.background,
    config.extension,
  );
  const { scene, camera, key } = setupScene(config.width, config.height);
  const host = document.createElement("div");
  host.style.cssText = `width:${config.width}px;height:${config.height}px;position:absolute;left:-10000px;top:0;`;
  host.appendChild(renderer.domElement);
  document.body.appendChild(host);

  const outcome: ShotOutcome = {
    loaded: false,
    nonBlankCanvas: false,
    meshCount: 0,
    loadTimeMs: 0,
    outputPath: null,
    warnings: [],
    error: null,
  };

  let object: Group | Mesh | null = null;
  let cleanupUrls: string[] = [];
  let cleanupCallbacks: Array<() => void> = [];

  try {
    const selected = await resolveSelectedFile(config.inputPath);
    if (
      getPreviewRenderingPresetForExtension(selected.extension) ===
      MMD_PREVIEW_RENDERING_PRESET
    ) {
      applyShotMmdLighting(scene, key);
    }
    if (config.mode === "check") {
      await validateUsdInspectorPipeline(
        selected.path,
        selected.extension,
        config.usdLoadPolicy,
      );
    }
    const started = performance.now();
    let sawDeferredTextures = false;
    let resolveDeferredTextures: (() => void) | null = null;
    const deferredTexturesDone = new Promise<void>((resolve) => {
      resolveDeferredTextures = resolve;
    });
    const preview = await loadPreviewObject(selected, renderer, {
      usdLoadPolicy: config.usdLoadPolicy,
      onDeferredTexture: (snapshot) => {
        sawDeferredTextures ||= snapshot.total > 0;
        if (snapshot.total > 0 && snapshot.pending === 0) {
          resolveDeferredTextures?.();
        }
      },
    });
    object = preview.object;
    cleanupUrls = preview.cleanupUrls;
    cleanupCallbacks = preview.cleanupCallbacks ?? [];
    outcome.warnings.push(...(preview.warnings ?? []));
    await syncMmdPreviewSpecularDirection(preview.mmdModel, key);
    if (config.motionPath && preview.mmdModel?.runtime) {
      const motion = await loadMmdMotion(
        await resolveSelectedFile(config.motionPath),
      );
      preview.mmdModel.runtime.setAnimation(
        motion.animation,
        preview.mmdModel.mesh,
      );
      preview.mmdModel.runtime.tick(0, {
        mesh: preview.mmdModel.mesh,
        ik: true,
        physics: false,
      });
      preview.mmdModel.syncMaterialMorphs?.();
      const sceneContext = {
        mmdModel: preview.mmdModel,
        mmdMotion: {
          animation: motion.animation,
          duration: Math.max(motion.duration, 1 / 30),
          currentTime: 0,
          label: motion.label,
        },
      } as SceneContext;
      const runtime = createMmdRuntime(sceneContext);
      runtime.animation?.seek(Math.min(0.5, motion.duration));
      runtime.dispose();
      await syncMmdPreviewSpecularDirection(preview.mmdModel, key);
    } else if (config.motionPath) {
      throw new Error(
        "MMD motion requires a loaded MMD model with runtime support.",
      );
    }
    applyShotMorphWeights(preview.mmdModel, config.morphWeights);
    if (sawDeferredTextures) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        deferredTexturesDone,
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, 30_000);
        }),
      ]);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
    outcome.loadTimeMs = Math.round((performance.now() - started) * 100) / 100;

    const normalization = normalizeObjectScale(object);
    const scaleWarning = getScaleWarning(object, normalization);
    if (scaleWarning) {
      outcome.warnings.push(scaleWarning);
    }
    scene.add(object);
    frameObject(camera, object);

    if (preview.clips.length > 0) {
      const mixer = new AnimationMixer(object);
      const action = mixer.clipAction(preview.clips[0]);
      action.play();
      mixer.setTime(0);
      action.paused = true;
    }

    outcome.loaded = true;
    outcome.meshCount = countMeshes(object);
    if (config.mode === "check" && countRenderableObjects(object) === 0) {
      if (preview.assetKind === "motion") {
        return outcome;
      }
      if (
        await isDeferredUsdEmptyCheckResult(
          selected.path,
          selected.extension,
          config.usdLoadPolicy,
        )
      ) {
        outcome.warnings.push(
          "USD payloads are deferred. Load payload prims from the hierarchy to display geometry.",
        );
        return outcome;
      }
      throw new Error(
        `No renderable geometry was loaded from ${selected.fileName}.`,
      );
    }

    await updateSparkRenderers(scene, camera);
    await settleFrames(renderer, scene, camera, 3);
    renderer.render(scene, camera);
    outcome.nonBlankCanvas = isRendererCanvasNonBlank(renderer);

    if (config.mode === "shot") {
      const screenshot = await captureRendererScreenshot(renderer, {
        beforeCapture: () => renderer.render(scene, camera),
      });
      outcome.outputPath = await writeOutput(
        screenshot.dataUrl,
        config.caseIndex,
      );
    }
  } catch (error) {
    outcome.error = errorMessage(error, "Shot case failed.");
    try {
      await logError(`[shot] ${config.fileName}: ${outcome.error}`);
    } catch {
      // Shot/check mode still returns the error through its outcome.
    }
  } finally {
    runShotCleanupCallbacks(cleanupCallbacks);
    if (object) {
      scene.remove(object);
      disposeObject(object);
    }
    revokeUrls(cleanupUrls);
    renderer.dispose();
    renderer.forceContextLoss();
    host.remove();
  }

  return outcome;
}
