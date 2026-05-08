import { invoke } from "@tauri-apps/api/core";
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { resolveSelectedFile } from "../lib/files";
import {
  collectAssetIssues,
  inspectStage,
  summarizeStage,
  type StageLoadPolicy,
} from "../lib/usd";
import {
  captureRendererScreenshot,
  disposeObject,
  isRendererCanvasNonBlank,
  loadPreviewObject,
  normalizeObjectScale,
  revokeUrls,
} from "../viewer";

export type ShotMode = "shot" | "check";

export type ShotConfig = {
  mode: ShotMode;
  inputPath: string;
  fileName: string;
  extension: string;
  width: number;
  height: number;
  background: string | null;
};

export type ShotOutcome = {
  loaded: boolean;
  nonBlankCanvas: boolean;
  meshCount: number;
  loadTimeMs: number;
  outputPath: string | null;
  error: string | null;
};

const DEFAULT_BG = "#111318";
const USD_EXTENSIONS = new Set(["usd", "usda", "usdc", "usdz"]);

export async function loadShotConfig() {
  return invoke<ShotConfig | null>("get_shot_config");
}

export async function finishShotRun(exitCode: number) {
  await invoke("finish_shot_run", { exitCode });
}

async function writeShotOutput(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
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
) {
  const bg = parseBackground(background);
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: bg.alpha,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
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
  return { scene, camera };
}

function frameObject(camera: PerspectiveCamera, object: Group | Mesh) {
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

function describeError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

async function validateUsdInspection(path: string, policy: StageLoadPolicy) {
  const [summary, inspection] = await Promise.all([
    summarizeStage(path, policy),
    inspectStage(path, policy),
  ]);

  if (summary.unresolvedReferenceCount > 0) {
    throw new Error(
      `USD inspection found ${summary.unresolvedReferenceCount} unresolved reference(s) under ${policy}.`,
    );
  }
  if (policy === "loadAll" && summary.unresolvedPayloadCount > 0) {
    throw new Error(
      `USD inspection found ${summary.unresolvedPayloadCount} unresolved payload(s) under ${policy}.`,
    );
  }
  if (policy === "loadAll" && inspection.missingAssets.length > 0) {
    throw new Error(
      `USD inspection found missing asset(s) under ${policy}: ${inspection.missingAssets.join(", ")}`,
    );
  }
}

async function validateUsdInspectorPipeline(path: string, extension: string) {
  if (!USD_EXTENSIONS.has(extension)) {
    return;
  }

  try {
    await validateUsdInspection(path, "loadAll");
    await validateUsdInspection(path, "noPayloads");
    const issues = await collectAssetIssues(path);
    const errors = issues.filter((issue) => issue.level === "error");
    if (errors.length > 0) {
      throw new Error(
        `USD asset issue(s): ${errors.map((issue) => issue.message).join("; ")}`,
      );
    }
  } catch (error) {
    throw new Error(
      `USD inspector validation failed: ${describeError(error, "unknown inspector error")}`,
      { cause: error },
    );
  }
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

export async function runShot(config: ShotConfig): Promise<ShotOutcome> {
  const renderer = createRenderer(
    config.width,
    config.height,
    config.background,
  );
  const { scene, camera } = setupScene(config.width, config.height);
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
    error: null,
  };

  let object: Group | Mesh | null = null;
  let cleanupUrls: string[] = [];

  try {
    const selected = await resolveSelectedFile(config.inputPath);
    if (config.mode === "check") {
      await validateUsdInspectorPipeline(selected.path, selected.extension);
    }
    const started = performance.now();
    const preview = await loadPreviewObject(selected, renderer);
    object = preview.object;
    cleanupUrls = preview.cleanupUrls;
    outcome.loadTimeMs = Math.round((performance.now() - started) * 100) / 100;

    normalizeObjectScale(object);
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

    if (config.mode === "shot") {
      await settleFrames(renderer, scene, camera, 3);
      renderer.render(scene, camera);
      outcome.nonBlankCanvas = isRendererCanvasNonBlank(renderer);
      const screenshot = await captureRendererScreenshot(renderer, {
        beforeCapture: () => renderer.render(scene, camera),
      });
      outcome.outputPath = await writeShotOutput(screenshot.dataUrl);
    }
  } catch (error) {
    outcome.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (object) {
      scene.remove(object);
      disposeObject(object);
    }
    revokeUrls(cleanupUrls);
    renderer.dispose();
    host.remove();
  }

  return outcome;
}
