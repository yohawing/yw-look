import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Camera, WebGLRendererParameters } from "three";
import {
  getRendererLifetimeBoundary,
  useViewportSceneLifecycle,
} from "../useViewportSceneLifecycle";
import type { SceneContext } from "../../viewer";

const rendererMocks = vi.hoisted(() => {
  const instances: Array<{
    domElement: HTMLCanvasElement;
    dispose: ReturnType<typeof vi.fn>;
    getPixelRatio: ReturnType<typeof vi.fn>;
    info: {
      memory: { geometries: number; textures: number };
      render: {
        calls: number;
        triangles: number;
        points: number;
        lines: number;
      };
      programs: unknown[];
    };
    parameters: WebGLRendererParameters | undefined;
    render: ReturnType<typeof vi.fn>;
    setClearColor: ReturnType<typeof vi.fn>;
    setPixelRatio: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
    shadowMap: { enabled: boolean; type: unknown };
  }> = [];

  return { instances };
});

const pickerMocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  flushPendingGpuPick: vi.fn(async () => undefined),
  pickSelectionKey: vi.fn(() => null),
  syncMountedObject: vi.fn(),
}));

vi.mock("../selection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../selection")>()),
  createViewportPicker: () => pickerMocks,
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();

  class MockPMREMGenerator {
    dispose = vi.fn();
    fromScene = vi.fn(() => ({
      dispose: vi.fn(),
      texture: new actual.Texture(),
    }));
  }

  class MockWebGLRenderer {
    domElement = document.createElement("canvas");
    info = {
      memory: { geometries: 0, textures: 0 },
      render: { calls: 0, triangles: 0, points: 0, lines: 0 },
      programs: [],
    };
    outputColorSpace: unknown;
    parameters: WebGLRendererParameters | undefined;
    shadowMap = { enabled: false, type: undefined as unknown };
    toneMapping: unknown;
    toneMappingExposure = 1;
    dispose = vi.fn();
    getPixelRatio = vi.fn(() => 1);
    render = vi.fn();
    setClearColor = vi.fn();
    setPixelRatio = vi.fn();
    setSize = vi.fn();

    constructor(parameters?: WebGLRendererParameters) {
      this.parameters = parameters;
      rendererMocks.instances.push(this);
    }
  }

  return {
    ...actual,
    PMREMGenerator: MockPMREMGenerator,
    WebGLRenderer: MockWebGLRenderer,
  };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: class MockOrbitControls {
    enabled = true;
    enableDamping = false;
    enablePan = false;
    enableRotate = false;
    enableZoom = false;
    maxDistance = 0;
    minDistance = 0;
    mouseButtons = {
      LEFT: undefined as unknown,
      MIDDLE: undefined as unknown,
      RIGHT: undefined as unknown,
    };
    panSpeed = 0;
    rotateSpeed = 0;
    target = {
      copy: vi.fn().mockReturnThis(),
      distanceTo: vi.fn(() => 5),
      set: vi.fn(),
    };
    zoomSpeed = 0;
    dispose = vi.fn();
    update = vi.fn();

    constructor() {}
  },
}));

vi.mock(
  "three/examples/jsm/renderers/CSS2DRenderer.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("three/examples/jsm/renderers/CSS2DRenderer.js")
      >();

    return {
      ...actual,
      CSS2DRenderer: class MockCSS2DRenderer {
        domElement = document.createElement("div");
        render = vi.fn();
        setSize = vi.fn();
      },
    };
  },
);

type MutableRef<T> = { current: T };

function ref<T>(current: T): MutableRef<T> {
  return { current };
}

function createHost() {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientHeight: { configurable: true, value: 480 },
    clientWidth: { configurable: true, value: 640 },
  });
  return host;
}

function makeLifecycleOptions() {
  const sceneContextRef = ref<SceneContext | null>(null);

  return {
    activeCameraIdRef: ref<string | null | undefined>(null),
    activeCameraRef: ref<Camera | null>(null),
    activeEnvironmentPresetRef: ref<"studio">("studio"),
    ambientLightRef: ref(null),
    backgroundPresetRef: ref<"gray">("gray"),
    cameraFovRef: ref(45),
    cameraSpeedMultiplierRef: ref(1),
    callbacks: {
      onFeedbackChange: vi.fn(),
      onGridUnitChange: vi.fn(),
      onMetadataChange: vi.fn(),
      onPackMetadataChange: vi.fn(),
    },
    clearResourceDiagnostics: vi.fn(),
    controlSensitivityRef: ref(1),
    environmentPresetRef: ref<"studio">("studio"),
    environmentRotationRef: ref(0),
    environmentTargetRef: ref(null),
    environmentTargetsRef: ref(null),
    exposureRef: ref(1),
    fillLightRef: ref(null),
    fxaaEnabledRef: ref(false),
    fxaaStateRef: ref(null),
    hostRef: { current: createHost() },
    keyLightRef: ref(null),
    onSelectMeshRef: ref(undefined),
    publishResourceDiagnostics: vi.fn(),
    renderScaleRef: ref(1),
    resetCameraRef: ref(null),
    sceneContextRef,
    shouldInitializeScene: true,
    showAxesRef: ref(true),
    showEnvironmentBackgroundRef: ref(false),
    showGridRef: ref(true),
    statsRef: { current: null },
    texturePreview3DRef: ref(false),
    toneMappingModeRef: ref<"aces">("aces"),
    viewerSurfaceModeRef: ref<"asset">("asset"),
  } satisfies Omit<
    Parameters<typeof useViewportSceneLifecycle>[0],
    "currentFileExtension"
  >;
}

afterEach(() => {
  cleanup();
  rendererMocks.instances.length = 0;
  pickerMocks.dispose.mockClear();
  pickerMocks.flushPendingGpuPick.mockClear();
  pickerMocks.pickSelectionKey.mockClear();
  pickerMocks.syncMountedObject.mockClear();
  vi.restoreAllMocks();
});

describe("getRendererLifetimeBoundary", () => {
  it.each(["glb", "fbx", "obj", "dae", "stl", "usd", "usdz", undefined])(
    "keeps the default renderer for .%s",
    (extension) => {
      expect(getRendererLifetimeBoundary(extension)).toBe(false);
    },
  );

  it.each(["pmx", "pmd"])(
    "requires a logarithmic-depth renderer for .%s",
    (extension) => {
      expect(getRendererLifetimeBoundary(extension)).toBe(true);
    },
  );

  it("groups default formats under the same lifetime boundary", () => {
    const defaultExtensions = ["glb", "fbx", "obj", "dae", "stl"] as const;
    const boundaries = defaultExtensions.map((extension) =>
      getRendererLifetimeBoundary(extension),
    );

    expect(new Set(boundaries).size).toBe(1);
    expect(boundaries[0]).toBe(false);
  });

  it("switches the lifetime boundary only across the MMD preset", () => {
    expect(getRendererLifetimeBoundary("glb")).not.toBe(
      getRendererLifetimeBoundary("pmx"),
    );
  });
});

describe("useViewportSceneLifecycle", () => {
  it("renders once before synchronizing a mounted object for BVH transfer", () => {
    const options = makeLifecycleOptions();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    renderHook(() =>
      useViewportSceneLifecycle({
        ...options,
        currentFileExtension: "glb",
      }),
    );

    const renderOrder =
      rendererMocks.instances[0].render.mock.invocationCallOrder[0];
    const syncOrder = pickerMocks.syncMountedObject.mock.invocationCallOrder[0];
    expect(renderOrder).toBeLessThan(syncOrder);
  });

  it("flushes GPU picking after color render with the active camera", () => {
    const options = makeLifecycleOptions();
    const activeCamera = {} as Camera;
    options.activeCameraRef.current = activeCamera;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    renderHook(() =>
      useViewportSceneLifecycle({
        ...options,
        currentFileExtension: "glb",
      }),
    );

    const renderOrder =
      rendererMocks.instances[0].render.mock.invocationCallOrder[0];
    const flushOrder =
      pickerMocks.flushPendingGpuPick.mock.invocationCallOrder[0];
    expect(renderOrder).toBeLessThan(flushOrder);
    expect(pickerMocks.flushPendingGpuPick).toHaveBeenCalledWith(
      expect.objectContaining({ camera: activeCamera }),
    );
  });

  it("reuses the renderer when switching among default-format extensions", () => {
    const options = makeLifecycleOptions();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const { rerender } = renderHook(
      ({ extension }: { extension: string }) =>
        useViewportSceneLifecycle({
          ...options,
          currentFileExtension: extension,
        }),
      { initialProps: { extension: "glb" } },
    );

    rerender({ extension: "fbx" });
    rerender({ extension: "obj" });

    expect(rendererMocks.instances).toHaveLength(1);
    expect(rendererMocks.instances[0]?.parameters).toMatchObject({
      logarithmicDepthBuffer: false,
    });
    expect(options.clearResourceDiagnostics).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it("recreates the renderer when crossing the MMD logarithmic-depth boundary", () => {
    const options = makeLifecycleOptions();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const { rerender } = renderHook(
      ({ extension }: { extension: string }) =>
        useViewportSceneLifecycle({
          ...options,
          currentFileExtension: extension,
        }),
      { initialProps: { extension: "glb" } },
    );

    rerender({ extension: "pmx" });
    rerender({ extension: "glb" });

    expect(rendererMocks.instances).toHaveLength(3);
    expect(
      rendererMocks.instances.map(
        (instance) => instance.parameters?.logarithmicDepthBuffer,
      ),
    ).toEqual([false, true, false]);
    expect(options.clearResourceDiagnostics).toHaveBeenCalledTimes(2);
  });
});
