import { beforeEach, describe, expect, it, vi } from "vitest";

const unloadedPayload = {
  state: "unloaded",
  sourcePrim: "/Payload",
  assetPath: "payload.usda",
  targetPrim: "/Payload",
} as const;

const mocks = vi.hoisted(() => ({
  collectAssetIssues: vi.fn(),
  disposeObject: vi.fn(),
  getScaleWarning: vi.fn(),
  inspectStage: vi.fn(),
  loadPreviewObject: vi.fn(),
  normalizeObjectScale: vi.fn(),
  resolveSelectedFile: vi.fn(),
  revokeUrls: vi.fn(),
  summarizeStage: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

class Object3D {
  children: Object3D[] = [];
  userData: Record<string, unknown> = {};
  scale = { multiplyScalar: vi.fn() };

  traverse(callback: (child: Object3D) => void) {
    callback(this);
    for (const child of this.children) {
      child.traverse(callback);
    }
  }
}

class Group extends Object3D {}
class Mesh extends Object3D {}
class Points extends Object3D {}
class Line extends Object3D {}
class LineSegments extends Object3D {}

class Scene extends Object3D {
  add(child: Object3D) {
    this.children.push(child);
  }

  remove(child: Object3D) {
    this.children = this.children.filter((value) => value !== child);
  }
}

class Vector3 {
  x = 0;
  y = 0;
  z = 0;

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(value: Vector3) {
    this.x = value.x;
    this.y = value.y;
    this.z = value.z;
    return this;
  }

  clone() {
    return new Vector3().copy(this);
  }

  add() {
    return this;
  }

  normalize() {
    return this;
  }

  multiplyScalar() {
    return this;
  }
}

class Box3 {
  setFromObject() {
    return this;
  }

  getSize(target: Vector3) {
    return target.set(0, 0, 0);
  }

  getCenter(target: Vector3) {
    return target.set(0, 0, 0);
  }
}

class PerspectiveCamera extends Object3D {
  position = new Vector3();
  near = 0.01;
  far = 1000;

  constructor(
    public fov = 45,
    public aspect = 1,
  ) {
    super();
  }

  lookAt() {}
  updateProjectionMatrix() {}
}

class AmbientLight extends Object3D {
  constructor(
    public color: string,
    public intensity: number,
  ) {
    super();
  }
}

class DirectionalLight extends Object3D {
  position = new Vector3();

  constructor(
    public color: string,
    public intensity: number,
  ) {
    super();
  }
}

class WebGLRenderer {
  domElement = document.createElement("canvas");

  setSize() {}
  setPixelRatio() {}
  setClearColor() {}
  render() {}
  dispose() {}
}

vi.mock("three", () => ({
  AmbientLight,
  AnimationMixer: class {},
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
}));

vi.mock("../../lib/files", () => ({
  resolveSelectedFile: mocks.resolveSelectedFile,
}));

vi.mock("../../lib/usd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/usd")>()),
  collectAssetIssues: mocks.collectAssetIssues,
  inspectStage: mocks.inspectStage,
  summarizeStage: mocks.summarizeStage,
}));

vi.mock("../../viewer", () => ({
  applyPreviewRenderingPreset: vi.fn(),
  captureRendererScreenshot: vi.fn(),
  disposeObject: mocks.disposeObject,
  getPreviewRenderingPresetForExtension: vi.fn(() => ({})),
  getScaleWarning: mocks.getScaleWarning,
  isRendererCanvasNonBlank: vi.fn(() => false),
  loadMmdMotion: vi.fn(),
  loadPreviewObject: mocks.loadPreviewObject,
  MMD_EXAMPLE_LIGHTING_PRESET: {
    ambientIntensity: 1,
    keyIntensity: 1,
    keyPosition: [1, 1, 1],
  },
  MMD_PREVIEW_RENDERING_PRESET: {},
  normalizeObjectScale: mocks.normalizeObjectScale,
  revokeUrls: mocks.revokeUrls,
  syncMmdPreviewSpecularDirection: vi.fn(),
}));

vi.mock("../../packs", () => ({
  createMmdRuntime: vi.fn(() => ({
    animation: null,
    dispose: vi.fn(),
  })),
  syncMmdPreviewSpecularDirection: vi.fn(),
}));

function selectedUsdFile() {
  return {
    path: "C:\\assets\\stage.usda",
    fileName: "stage.usda",
    extension: "usda",
    kind: "model",
    parentDirectory: "C:\\assets",
  };
}

function baseShotConfig() {
  return {
    caseIndex: 0,
    mode: "check" as const,
    inputPath: "C:\\assets\\stage.usda",
    fileName: "stage.usda",
    extension: "usda",
    motionPath: null,
    width: 64,
    height: 64,
    background: null,
    usdLoadPolicy: "noPayloads" as const,
  };
}

function emptyPreview() {
  return {
    object: new Group(),
    cleanupUrls: [],
    clips: [],
    warnings: [],
    formatVersion: null,
  };
}

describe("isDeferredUsdEmptyCheckOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows empty noPayloads USD checks when all renderable geometry is deferred", async () => {
    const { isDeferredUsdEmptyCheckOutcome } = await import("../shotRuntime");

    expect(
      isDeferredUsdEmptyCheckOutcome(
        "usda",
        "noPayloads",
        { totalVertices: 0, unloadedPayloadCount: 2 },
        { payloads: [unloadedPayload] },
      ),
    ).toBe(true);
  });

  it("keeps empty non-deferred USD checks as failures", async () => {
    const { isDeferredUsdEmptyCheckOutcome } = await import("../shotRuntime");

    expect(
      isDeferredUsdEmptyCheckOutcome(
        "usda",
        "noPayloads",
        { totalVertices: 0, unloadedPayloadCount: 0 },
        { payloads: [] },
      ),
    ).toBe(false);
  });

  it("does not allow non-USD or loadAll empty checks", async () => {
    const { isDeferredUsdEmptyCheckOutcome } = await import("../shotRuntime");
    const summary = { totalVertices: 0, unloadedPayloadCount: 1 };
    const inspection = { payloads: [unloadedPayload] };

    expect(
      isDeferredUsdEmptyCheckOutcome("glb", "noPayloads", summary, inspection),
    ).toBe(false);
    expect(
      isDeferredUsdEmptyCheckOutcome("usda", "loadAll", summary, inspection),
    ).toBe(false);
  });
});

describe("runShot USD check mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSelectedFile.mockResolvedValue(selectedUsdFile());
    mocks.collectAssetIssues.mockResolvedValue([]);
    mocks.getScaleWarning.mockReturnValue(null);
    mocks.loadPreviewObject.mockResolvedValue(emptyPreview());
    mocks.normalizeObjectScale.mockReturnValue({});
  });

  it("treats empty noPayloads deferred payload previews as a successful check", async () => {
    const { runShot } = await import("../shotRuntime");
    mocks.summarizeStage.mockResolvedValue({
      totalVertices: 0,
      unloadedPayloadCount: 1,
      unresolvedReferenceCount: 0,
      unresolvedPayloadCount: 0,
    });
    mocks.inspectStage.mockResolvedValue({
      payloads: [unloadedPayload],
      missingAssets: [],
    });

    const outcome = await runShot(baseShotConfig());

    expect(outcome.error).toBeNull();
    expect(outcome.loaded).toBe(true);
    expect(outcome.meshCount).toBe(0);
    expect(outcome.warnings).toContain(
      "USD payloads are deferred. Load payload prims from the hierarchy to display geometry.",
    );
  });

  it("keeps empty non-deferred previews as check failures", async () => {
    const { runShot } = await import("../shotRuntime");
    mocks.summarizeStage.mockResolvedValue({
      totalVertices: 0,
      unloadedPayloadCount: 0,
      unresolvedReferenceCount: 0,
      unresolvedPayloadCount: 0,
    });
    mocks.inspectStage.mockResolvedValue({
      payloads: [],
      missingAssets: [],
    });

    const outcome = await runShot(baseShotConfig());

    expect(outcome.error).toBe(
      "No renderable geometry was loaded from stage.usda.",
    );
    expect(outcome.loaded).toBe(true);
  });
});
