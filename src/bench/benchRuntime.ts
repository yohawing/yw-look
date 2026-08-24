import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "../lib/errors";
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  DirectionalLight,
  Group,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { SelectedFile } from "../lib/files";
import type { DeferredTextureSnapshot } from "../types/viewer";
import { listSupportedSiblings, resolveSelectedFile } from "../lib/files";
import {
  captureRendererScreenshot,
  disposeObject,
  isRendererCanvasNonBlank,
  loadPreviewObject,
  normalizeObjectScale,
  revokeUrls,
} from "../viewer";
import type {
  BenchCaseResult,
  BenchConfig,
  BenchLoadResponsiveness,
  BenchManifest,
  BenchModel,
  BenchReport,
  BenchStageId,
  BenchStageMetrics,
  DeferredTextureCounts,
  RendererMemoryMetrics,
  RendererRenderMetrics,
} from "./benchTypes";

type PerformanceWithMemory = Performance & {
  memory?: Record<string, number>;
};

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;
const LOAD_RESPONSIVENESS_PROBE_INTERVAL_MS = 16;
let activeBenchRepoRoot = "";

export function responsivenessGapMs(
  previousTickAt: number,
  currentTickAt: number,
  expectedIntervalMs: number,
) {
  return Math.max(0, currentTickAt - previousTickAt - expectedIntervalMs);
}

export async function measureMainThreadResponsiveness<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; metrics: BenchLoadResponsiveness }> {
  let maxGapMs = 0;
  let sampleCount = 0;
  let lastTickAt = performance.now();

  const recordSample = (now: number) => {
    const gap = responsivenessGapMs(
      lastTickAt,
      now,
      LOAD_RESPONSIVENESS_PROBE_INTERVAL_MS,
    );
    lastTickAt = now;
    sampleCount += 1;
    if (gap > maxGapMs) {
      maxGapMs = gap;
    }
  };

  const intervalId = window.setInterval(() => {
    recordSample(performance.now());
  }, LOAD_RESPONSIVENESS_PROBE_INTERVAL_MS);

  try {
    const value = await operation();
    const finishedAt = performance.now();
    if (finishedAt - lastTickAt >= LOAD_RESPONSIVENESS_PROBE_INTERVAL_MS) {
      recordSample(finishedAt);
    }
    return {
      value,
      metrics: {
        sampleCount,
        maxGapMs: sampleCount > 0 ? roundMetric(maxGapMs) : null,
      },
    };
  } finally {
    window.clearInterval(intervalId);
  }
}

export async function loadBenchConfig() {
  const config = await invoke<BenchConfig | null>("get_bench_config");
  activeBenchRepoRoot = config?.repoRoot ?? "";
  return config;
}

export async function loadBenchManifest() {
  const text = await invoke<string>("read_bench_manifest");
  return JSON.parse(text) as BenchManifest;
}

function isAbsolutePath(path: string) {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

function resolveBenchModelPath(modelPath: string, repoRoot: string) {
  if (isAbsolutePath(modelPath) || repoRoot.trim() === "") {
    return modelPath;
  }

  const root = repoRoot.replace(/[\\/]+$/, "");
  const relative = modelPath.replace(/^[\\/]+/, "");
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root}${separator}${relative}`;
}

function createRenderer() {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor("#111318");
  return renderer;
}

function setupScene() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    45,
    VIEWPORT_WIDTH / VIEWPORT_HEIGHT,
    0.01,
    1000,
  );
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

function countMeshes(object: Object3D) {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof Mesh) {
      count += 1;
    }
  });
  return count;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return roundMetric(sorted[index]);
}

function roundMetric(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 100) / 100;
}

function roundStageMetrics(metrics: BenchStageMetrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([stage, value]) => [
      stage,
      roundMetric(value),
    ]),
  ) as BenchStageMetrics;
}

async function measureAsync<T>(operation: () => Promise<T>) {
  const started = performance.now();
  const value = await operation();
  return {
    value,
    elapsedMs: roundMetric(performance.now() - started),
  };
}

function rendererMemoryMetrics(renderer: WebGLRenderer): RendererMemoryMetrics {
  return {
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };
}

function rendererRenderMetrics(renderer: WebGLRenderer): RendererRenderMetrics {
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    points: renderer.info.render.points,
    lines: renderer.info.render.lines,
  };
}

function getPerformanceMemory() {
  const memory = (performance as PerformanceWithMemory).memory;
  if (!memory) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(memory).filter(([, value]) => typeof value === "number"),
  );
}

function waitFrame() {
  return new Promise<number>((resolve) => requestAnimationFrame(resolve));
}

async function settleFrames(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  frames: number,
) {
  for (let index = 0; index < Math.max(frames, 1); index += 1) {
    await waitFrame();
    renderer.render(scene, camera);
  }
}

async function measureFrames(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  runs: number,
) {
  const deltas: number[] = [];
  let previous = await waitFrame();

  for (let index = 0; index < Math.max(runs, 1); index += 1) {
    const current = await waitFrame();
    deltas.push(current - previous);
    previous = current;
    renderer.render(scene, camera);
  }

  const avg =
    deltas.length === 0
      ? null
      : deltas.reduce((total, value) => total + value, 0) / deltas.length;

  return {
    fps: avg ? roundMetric(1000 / avg) : null,
    frameTimeMs: {
      avg: roundMetric(avg),
      p50: percentile(deltas, 50),
      p95: percentile(deltas, 95),
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      Math.max(0, timeoutMs),
    );
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

type DeferredTextureCompletion = {
  counts: DeferredTextureCounts;
  completedAt: number;
};

export function createDeferredTextureTracker(
  now: () => number = () => performance.now(),
) {
  let latestSnapshot: DeferredTextureSnapshot | null = null;
  let latestCompletedAt: number | null = null;
  let resolveCompletion:
    ((completion: DeferredTextureCompletion) => void) | null = null;

  const completionFromLatest = (): DeferredTextureCompletion | null => {
    if (
      !latestSnapshot ||
      latestSnapshot.total <= 0 ||
      latestSnapshot.pending !== 0 ||
      latestSnapshot.loaded + latestSnapshot.failed !== latestSnapshot.total
    ) {
      return null;
    }
    return {
      counts: {
        total: latestSnapshot.total,
        loaded: latestSnapshot.loaded,
        failed: latestSnapshot.failed,
      },
      completedAt: latestCompletedAt ?? now(),
    };
  };

  return {
    onSnapshot(snapshot: DeferredTextureSnapshot) {
      latestSnapshot = snapshot;
      latestCompletedAt =
        snapshot.total > 0 &&
        snapshot.pending === 0 &&
        snapshot.loaded + snapshot.failed === snapshot.total
          ? now()
          : null;
      const completion = completionFromLatest();
      if (completion && resolveCompletion) {
        const resolve = resolveCompletion;
        resolveCompletion = null;
        resolve(completion);
      }
    },
    hasDeferredWork() {
      return (latestSnapshot?.total ?? 0) > 0;
    },
    waitForCompletion() {
      const completion = completionFromLatest();
      if (completion) {
        return Promise.resolve(completion);
      }
      return new Promise<DeferredTextureCompletion>((resolve) => {
        resolveCompletion = resolve;
      });
    },
  };
}

function runBenchCleanupCallbacks(callbacks: Array<() => void>) {
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      console.error("Bench cleanup callback failed", error);
    }
  }
}

async function saveScreenshot(fileName: string, dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  await invoke("write_bench_screenshot", {
    fileName,
    pngBytes: Array.from(bytes),
  });
}

function selectedFileFromModel(model: BenchModel, fallback: SelectedFile) {
  return {
    ...fallback,
    extension: model.ext.toLowerCase(),
  };
}

export async function runBenchCase(
  model: BenchModel,
  log: (message: string) => void,
): Promise<BenchCaseResult> {
  const renderer = createRenderer();
  const { scene, camera } = setupScene();
  const host = document.createElement("div");
  host.style.cssText =
    "width:1024px;height:768px;position:absolute;left:-10000px;top:0;";
  host.appendChild(renderer.domElement);
  document.body.appendChild(host);

  let object: Group | Mesh | null = null;
  let cleanupUrls: string[] = [];
  let cleanupCallbacks: Array<() => void> = [];
  const stageTimeMs: BenchStageMetrics = {};
  let activeStage: BenchStageId | null = null;
  let activeStageStartedAt = 0;

  const recordStage = (stage: BenchStageId) => {
    log(`stage ${model.id}: ${stage}`);
    const now = performance.now();
    if (activeStage !== null) {
      stageTimeMs[activeStage] =
        (stageTimeMs[activeStage] ?? 0) + now - activeStageStartedAt;
    }
    activeStage = stage;
    activeStageStartedAt = now;
  };

  const finishActiveStage = () => {
    if (activeStage === null) {
      return;
    }
    stageTimeMs[activeStage] =
      (stageTimeMs[activeStage] ?? 0) +
      performance.now() -
      activeStageStartedAt;
    activeStage = null;
  };

  const baseResult: BenchCaseResult = {
    id: model.id,
    name: model.name,
    path: model.path,
    ext: model.ext,
    license: model.license,
    tags: model.tags,
    shouldLoad: model.expect.shouldLoad,
    loaded: false,
    consoleErrors: 0,
    nonBlankCanvas: false,
    meshCount: 0,
    minMeshCount: model.expect.minMeshCount,
    openPipelineMs: null,
    resolveFileMs: null,
    listSiblingsMs: null,
    loadTimeMs: null,
    textureReadyMs: null,
    deferredTextureMs: null,
    deferredTextureCounts: null,
    loadResponsiveness: null,
    stageTimeMs: {},
    fps: null,
    frameTimeMs: { avg: null, p50: null, p95: null },
    rendererInfo: null,
    performanceMemory: null,
    screenshot: null,
    error: null,
  };

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    baseResult.consoleErrors += 1;
    originalConsoleError(...args);
  };

  try {
    log(`loading ${model.id}`);
    const modelPath = resolveBenchModelPath(model.path, activeBenchRepoRoot);
    const openStarted = performance.now();
    const [resolved, siblingListing] = await Promise.all([
      measureAsync(() => resolveSelectedFile(modelPath)),
      measureAsync(() => listSupportedSiblings(modelPath)),
    ]);
    void siblingListing.value;
    baseResult.resolveFileMs = resolved.elapsedMs;
    baseResult.listSiblingsMs = siblingListing.elapsedMs;

    const selected = selectedFileFromModel(model, resolved.value);
    const loadStarted = performance.now();
    const loadDeadline = loadStarted + model.bench.timeoutMs;
    const deferredTextureTracker = createDeferredTextureTracker();
    const loadResult = await measureMainThreadResponsiveness(() =>
      withTimeout(
        loadPreviewObject(selected, renderer, {
          onStage: recordStage,
          onDeferredTexture: deferredTextureTracker.onSnapshot,
        }),
        loadDeadline - performance.now(),
        model.id,
      ),
    );
    const preview = loadResult.value;
    baseResult.loadResponsiveness = loadResult.metrics;
    finishActiveStage();
    object = preview.object;
    cleanupUrls = preview.cleanupUrls;
    cleanupCallbacks = preview.cleanupCallbacks ?? [];
    const shellReadyAt = performance.now();
    baseResult.loadTimeMs = roundMetric(shellReadyAt - loadStarted);
    baseResult.openPipelineMs = roundMetric(performance.now() - openStarted);

    if (deferredTextureTracker.hasDeferredWork()) {
      const completion = await withTimeout(
        deferredTextureTracker.waitForCompletion(),
        loadDeadline - performance.now(),
        `${model.id} deferred textures`,
      );
      const textureReadyAt = Math.max(shellReadyAt, completion.completedAt);
      baseResult.textureReadyMs = roundMetric(textureReadyAt - loadStarted);
      baseResult.deferredTextureMs = roundMetric(textureReadyAt - shellReadyAt);
      baseResult.deferredTextureCounts = completion.counts;
    }

    normalizeObjectScale(object);
    scene.add(object);
    frameObject(camera, object);

    if (preview.clips.length > 0 && !model.bench.noAnimation) {
      const mixer = new AnimationMixer(object);
      const action = mixer.clipAction(preview.clips[0]);
      action.play();
      if (typeof model.bench.timeSeek === "number") {
        mixer.setTime(model.bench.timeSeek);
        action.paused = true;
      }
    }

    await settleFrames(renderer, scene, camera, model.bench.settleFrames);
    const frameMetrics = await measureFrames(
      renderer,
      scene,
      camera,
      model.bench.runs,
    );
    renderer.render(scene, camera);

    baseResult.loaded = true;
    baseResult.meshCount = countMeshes(object);
    baseResult.nonBlankCanvas = isRendererCanvasNonBlank(renderer);
    baseResult.fps = frameMetrics.fps;
    baseResult.frameTimeMs = frameMetrics.frameTimeMs;
    baseResult.rendererInfo = {
      memory: rendererMemoryMetrics(renderer),
      render: rendererRenderMetrics(renderer),
    };
    baseResult.performanceMemory = getPerformanceMemory();

    if (model.bench.screenshot) {
      const screenshotFile = `${model.id}.png`;
      const screenshot = await captureRendererScreenshot(renderer, {
        beforeCapture: () => renderer.render(scene, camera),
      });
      await saveScreenshot(screenshotFile, screenshot.dataUrl);
      baseResult.screenshot = `screenshots/${screenshotFile}`;
    }
  } catch (error) {
    baseResult.error = errorMessage(error, "Bench case failed.");
  } finally {
    runBenchCleanupCallbacks(cleanupCallbacks);
    if (object) {
      scene.remove(object);
      disposeObject(object);
    }
    revokeUrls(cleanupUrls);
    renderer.dispose();
    host.remove();
    console.error = originalConsoleError;
    finishActiveStage();
    baseResult.stageTimeMs = roundStageMetrics(stageTimeMs);
  }

  return baseResult;
}

export function buildReport(config: BenchConfig, cases: BenchCaseResult[]) {
  const failed = cases.filter(
    (result) =>
      result.error !== null ||
      result.loaded !== result.shouldLoad ||
      result.consoleErrors > 0 ||
      (result.shouldLoad && result.meshCount < result.minMeshCount) ||
      (result.shouldLoad && result.nonBlankCanvas === false),
  ).length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: config.mode,
    appVersion: config.appVersion,
    os: config.os,
    arch: config.arch,
    nodeVersion: config.nodeVersion,
    modelsPath: config.modelsPath,
    repoRoot: config.repoRoot,
    outDir: config.outDir,
    caseIds: config.caseIds,
    summary: {
      total: cases.length,
      loaded: cases.filter((result) => result.loaded).length,
      nonBlank: cases.filter((result) => result.nonBlankCanvas).length,
      failed,
    },
    cases,
  } satisfies BenchReport;
}

export function renderReportMarkdown(report: BenchReport) {
  const lines = [
    "# yw-look Load Bench",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- App version: ${report.appVersion}`,
    `- Platform: ${report.os}/${report.arch}`,
    `- Node: ${report.nodeVersion ?? "unknown"}`,
    "",
    "| Case | Loaded | Non-blank | Console errors | Meshes | Open ms | Resolve ms | Siblings ms | Preview load ms | Texture ready ms | Deferred ms | Texture loaded | Texture failed | Texture total | Resp samples | Resp max gap ms | USD resolve ms | USD decode ms | WebView/GPU ms | Scene ms | FPS | p50 ms | p95 ms | Error |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];

  for (const result of report.cases) {
    lines.push(
      [
        result.id,
        result.loaded ? "yes" : "no",
        result.nonBlankCanvas ? "yes" : "no",
        result.consoleErrors,
        `${result.meshCount}/${result.minMeshCount}`,
        result.openPipelineMs ?? result.loadTimeMs ?? "",
        result.resolveFileMs ?? "",
        result.listSiblingsMs ?? "",
        result.loadTimeMs ?? "",
        result.textureReadyMs ?? "",
        result.deferredTextureMs ?? "",
        result.deferredTextureCounts?.loaded ?? "",
        result.deferredTextureCounts?.failed ?? "",
        result.deferredTextureCounts?.total ?? "",
        result.loadResponsiveness?.sampleCount ?? "",
        result.loadResponsiveness?.maxGapMs ?? "",
        result.stageTimeMs.resolve ?? "",
        result.stageTimeMs.decode ?? "",
        result.stageTimeMs.gpu ?? "",
        result.stageTimeMs.scene ?? "",
        result.fps ?? "",
        result.frameTimeMs.p50 ?? "",
        result.frameTimeMs.p95 ?? "",
        result.error?.replaceAll("|", "\\|") ?? "",
      ].join(" | "),
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function writeBenchReport(report: BenchReport) {
  await invoke("write_bench_report", {
    reportJson: JSON.stringify(report, null, 2),
    reportMarkdown: renderReportMarkdown(report),
  });
}

export async function writeBenchStatus(status: unknown) {
  await invoke("write_bench_status", {
    statusJson: JSON.stringify(status, null, 2),
  });
}

export async function finishBenchRun(exitCode: number) {
  await invoke("finish_bench_run", { exitCode });
}
