export type BenchExpectation = {
  shouldLoad: boolean;
  nonBlankCanvas: boolean;
  minMeshCount: number;
};

export type BenchOptions = {
  runs: number;
  timeoutMs: number;
  settleFrames: number;
  screenshot: boolean;
  noAnimation?: boolean;
  timeSeek?: number;
};

export type BenchModel = {
  id: string;
  name: string;
  url: string;
  sha256: string | null;
  sizeBytes: number | null;
  license: string;
  tags: string[];
  ext: string;
  path: string;
  expect: BenchExpectation;
  bench: BenchOptions;
};

export type BenchManifest = {
  version: 1;
  models: BenchModel[];
};

export type BenchConfig = {
  enabled: boolean;
  modelsPath: string;
  repoRoot: string;
  outDir: string;
  caseIds: string[];
  mode: "dev" | "release";
  appVersion: string;
  os: string;
  arch: string;
  nodeVersion: string | null;
};

export type RendererMemoryMetrics = {
  geometries: number;
  textures: number;
};

export type RendererRenderMetrics = {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
};

export type BenchStageId =
  | "scan"
  | "resolve"
  | "decode"
  | "gpu"
  | "scene"
  | "ui";

export type BenchStageMetrics = Partial<Record<BenchStageId, number>>;

export type BenchLoadResponsiveness = {
  sampleCount: number;
  maxGapMs: number | null;
};

export type BenchCaseResult = {
  id: string;
  name: string;
  path: string;
  ext: string;
  license: string;
  tags: string[];
  shouldLoad: boolean;
  loaded: boolean;
  consoleErrors: number;
  nonBlankCanvas: boolean;
  meshCount: number;
  minMeshCount: number;
  openPipelineMs: number | null;
  resolveFileMs: number | null;
  listSiblingsMs: number | null;
  loadTimeMs: number | null;
  loadResponsiveness: BenchLoadResponsiveness | null;
  stageTimeMs: BenchStageMetrics;
  fps: number | null;
  frameTimeMs: {
    avg: number | null;
    p50: number | null;
    p95: number | null;
  };
  rendererInfo: {
    memory: RendererMemoryMetrics;
    render: RendererRenderMetrics;
  } | null;
  performanceMemory: Record<string, number> | null;
  screenshot: string | null;
  error: string | null;
};

export type BenchReport = {
  schemaVersion: 1;
  generatedAt: string;
  mode: "dev" | "release";
  appVersion: string;
  os: string;
  arch: string;
  nodeVersion: string | null;
  modelsPath: string;
  repoRoot: string;
  outDir: string;
  caseIds: string[];
  summary: {
    total: number;
    loaded: number;
    nonBlank: number;
    failed: number;
  };
  cases: BenchCaseResult[];
};
