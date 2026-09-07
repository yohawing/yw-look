import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SceneContext } from "../../viewer";
import type { SelectedFile } from "../../types/file";
import type { AssetViewportProps } from "../../viewport/types";
import { AssetViewport } from "../AssetViewport";

const viewportMocks = vi.hoisted(() => ({
  context: null as SceneContext | null,
  diagnostics: {
    assetResourceMetricsRef: { current: null },
    clearResourceDiagnostics: vi.fn(),
    publishResourceDiagnostics: vi.fn(),
  },
  loadPreviewObject: vi.fn(),
  mountLoadedPreview: vi.fn(),
  resetSceneObjects: vi.fn(),
}));

vi.mock("../../viewer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../viewer")>();
  return {
    ...actual,
    applyPreviewLightingPreset: vi.fn(),
    loadPreviewObject: viewportMocks.loadPreviewObject,
    resetSceneObjects: viewportMocks.resetSceneObjects,
    revokeUrls: vi.fn(),
    stopAnimations: vi.fn(),
  };
});

vi.mock("../../packs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packs")>();
  return { ...actual, usePackFileRequest: vi.fn() };
});

vi.mock("../../viewport/camera", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../viewport/camera")>();
  return {
    ...actual,
    applyCameraPresetToMountedObject: vi.fn(),
    applyControlSensitivity: vi.fn(),
    configureAssetControls: vi.fn(),
    frameCurrentMountedObject: vi.fn(),
    syncActiveCameraSelection: vi.fn(() => null),
    syncAxesVisibility: vi.fn(),
    syncGridVisibility: vi.fn(),
  };
});

vi.mock("../../viewport/renderSettings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../viewport/renderSettings")>();
  return {
    ...actual,
    applyViewportBackground: vi.fn(),
    applyViewportRenderingSettings: vi.fn(),
    runCleanupCallbacks: vi.fn(),
  };
});

vi.mock("../../viewport/selection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../viewport/selection")>();
  return {
    ...actual,
    applyPurposeVisibility: vi.fn(),
    findObjectBySelectionKey: vi.fn(() => null),
  };
});

vi.mock("../../viewport/useResourceDiagnosticsPublisher", () => ({
  useResourceDiagnosticsPublisher: () => viewportMocks.diagnostics,
}));

vi.mock("../../viewport/useSceneObjectEffects", () => ({
  useSceneObjectEffects: vi.fn(),
}));

vi.mock("../../viewport/useTexturePreview", () => ({
  useTexturePreview: vi.fn(),
}));

vi.mock("../../viewport/useViewportAnimation", () => ({
  useViewportAnimation: () => ({
    handleSeek: vi.fn(),
    handleSelectClip: vi.fn(),
    handleStep: vi.fn(),
    handleTogglePlayback: vi.fn(),
    looping: true,
    playbackRate: 1,
    loopRange: null,
    handleSetLoopRange: vi.fn(),
    handleSetLooping: vi.fn(),
    handleSetPlaybackRate: vi.fn(),
    hasAnimation: false,
  }),
}));

vi.mock("../../viewport/useViewportSceneLifecycle", () => ({
  useViewportSceneLifecycle: ({
    sceneContextRef,
  }: {
    sceneContextRef: { current: SceneContext | null };
  }) => {
    sceneContextRef.current = viewportMocks.context;
  },
}));

vi.mock("../../viewport/previewLoadMount", () => ({
  mountLoadedPreview: viewportMocks.mountLoadedPreview,
}));

const fileA: SelectedFile = {
  path: "samples/assets/usd/variant-a.usda",
  fileName: "variant-a.usda",
  extension: "usda",
  kind: "model",
  parentDirectory: "samples/assets/usd",
};
const fileB: SelectedFile = {
  ...fileA,
  path: "samples/assets/usd/variant-b.usda",
};

function makeBuffer(byteLength: number) {
  return new ArrayBuffer(byteLength);
}

function makeContext(): SceneContext {
  return {
    renderer: { setPixelRatio: vi.fn() },
    scene: {
      add: vi.fn(),
      remove: vi.fn(),
      environmentRotation: { set: vi.fn() },
      backgroundRotation: { set: vi.fn() },
    },
    camera: { updateProjectionMatrix: vi.fn() },
    controls: { enabled: false },
    pmremGenerator: {},
    mountedObject: null,
    sourceObject: null,
    previewObject: null,
    boneOnlyPreview: false,
    cleanupUrls: [],
    cleanupCallbacks: [],
    animationRoot: null,
    mixer: null,
    clips: [],
    activeAction: null,
    packRuntime: null,
    mmdModel: null,
    mmdMotion: null,
    mmdLightSync: null,
    textureRegistry: new Map(),
    rawMaxDimension: 1,
  } as unknown as SceneContext;
}

function makeProps(
  currentFile: SelectedFile,
  glbOverride: ArrayBuffer | null,
  variantName: string,
): AssetViewportProps {
  return {
    currentFile,
    disabledOptionalLoaderPackIds: [],
    incompatibleOptionalLoaderPackIds: [],
    displayMode: "textured",
    backgroundPreset: "gray",
    onFeedbackChange: vi.fn(),
    onMetadataChange: vi.fn(),
    onPackMetadataChange: vi.fn(),
    onGridUnitChange: vi.fn(),
    selectedTextureId: null,
    viewerSurfaceMode: "asset",
    textureViewMode: "rgb",
    textureExposure: 0,
    textureBlackPoint: 0,
    textureWhitePoint: 1,
    textureTileCount: 1,
    textureGamma: 1,
    showGrid: true,
    showAxes: true,
    showSkeleton: false,
    showLocalAxis: false,
    showJointNames: false,
    showBoundingBoxes: false,
    showNormals: false,
    showVertexColors: false,
    showEnvironmentBackground: false,
    environmentRotation: 0,
    backfaceCulling: true,
    textureFilterMode: "linear",
    showShadows: false,
    showUnlit: false,
    controlSensitivity: 1,
    cameraFov: 45,
    renderScale: 1,
    fxaaEnabled: false,
    showRendererStats: false,
    toneMappingMode: "aces",
    exposure: 1,
    environmentPreset: "studio",
    cameraSpeedMultiplier: 1,
    usdLoadPolicy: "noPayloads",
    usdInspection: null,
    texturePreview3D: false,
    purposeModes: { render: true, proxy: false, guide: false },
    variantSelections: [
      {
        primPath: "/Root/Asset",
        setName: "modelingVariant",
        variantName,
      },
    ],
    glbOverride,
  };
}

describe("AssetViewport", () => {
  beforeEach(() => {
    viewportMocks.context = makeContext();
    viewportMocks.loadPreviewObject.mockReset().mockResolvedValue({});
    viewportMocks.mountLoadedPreview.mockReset().mockImplementation(
      async (
        _result: unknown,
        options: {
          context: SceneContext;
          currentFile: SelectedFile;
          replaceExistingPreview?: boolean;
          preserveCameraView?: boolean;
          update: {
            setActivePreviewPath: (path: string) => void;
            setOverlayReady: () => void;
          };
        },
      ) => {
        const object = new Group();
        options.context.mountedObject = object;
        options.context.sourceObject = object;
        options.update.setActivePreviewPath(options.currentFile.path);
        options.update.setOverlayReady();
        return { message: "Preview ready", warnings: [] };
      },
    );
    viewportMocks.resetSceneObjects
      .mockReset()
      .mockImplementation((context: SceneContext) => {
        context.mountedObject = null;
        context.sourceObject = null;
      });
    viewportMocks.diagnostics.assetResourceMetricsRef.current = null;
    viewportMocks.diagnostics.clearResourceDiagnostics.mockClear();
    viewportMocks.diagnostics.publishResourceDiagnostics.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the mounted preview across consecutive pending GLB refreshes", async () => {
    const initialBuffer = makeBuffer(64);
    let resolveRefresh!: (value: unknown) => void;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    viewportMocks.loadPreviewObject
      .mockReset()
      .mockResolvedValue({})
      .mockResolvedValueOnce({})
      .mockImplementationOnce(() => refreshPromise as never);
    const initialProps = makeProps(fileA, initialBuffer, "A");
    const { container, rerender } = render(<AssetViewport {...initialProps} />);

    await waitFor(() => {
      expect(viewportMocks.mountLoadedPreview).toHaveBeenCalledTimes(1);
    });
    expect(viewportMocks.context?.mountedObject).not.toBeNull();
    await waitFor(() => {
      expect(container.querySelector(".viewport-overlay")).toBeNull();
    });
    expect(viewportMocks.loadPreviewObject).toHaveBeenCalledTimes(1);
    const mountedObjectAfterInitialLoad = viewportMocks.context?.mountedObject;
    const cleanupCountAfterInitialLoad =
      viewportMocks.resetSceneObjects.mock.calls.length;

    const variantBProps = makeProps(fileA, null, "B");
    const variantBFeedback = vi.fn();
    variantBProps.onFeedbackChange = variantBFeedback;
    rerender(<AssetViewport {...variantBProps} />);
    await waitFor(() => {
      expect(viewportMocks.resetSceneObjects).toHaveBeenCalledTimes(
        cleanupCountAfterInitialLoad,
      );
    });
    expect(viewportMocks.loadPreviewObject).toHaveBeenCalledTimes(1);
    expect(viewportMocks.mountLoadedPreview).toHaveBeenCalledTimes(1);
    expect(viewportMocks.context?.mountedObject).toBe(
      mountedObjectAfterInitialLoad,
    );
    expect(container.querySelector(".viewport-overlay")).toBeNull();
    expect(variantBFeedback).not.toHaveBeenCalled();

    const variantCProps = makeProps(fileA, null, "C");
    const variantCFeedback = vi.fn();
    variantCProps.onFeedbackChange = variantCFeedback;
    rerender(<AssetViewport {...variantCProps} />);
    await waitFor(() => {
      expect(viewportMocks.mountLoadedPreview).toHaveBeenCalledTimes(1);
    });
    expect(viewportMocks.loadPreviewObject).toHaveBeenCalledTimes(1);
    expect(viewportMocks.resetSceneObjects).toHaveBeenCalledTimes(
      cleanupCountAfterInitialLoad,
    );
    expect(viewportMocks.context?.mountedObject).toBe(
      mountedObjectAfterInitialLoad,
    );
    expect(container.querySelector(".viewport-overlay")).toBeNull();
    expect(variantCFeedback).not.toHaveBeenCalled();

    const refreshedBuffer = makeBuffer(128);
    const refreshedProps = makeProps(fileA, refreshedBuffer, "C");
    const refreshedFeedback = vi.fn();
    refreshedProps.onFeedbackChange = refreshedFeedback;
    rerender(<AssetViewport {...refreshedProps} />);
    await waitFor(() => {
      expect(viewportMocks.loadPreviewObject).toHaveBeenCalledTimes(2);
    });
    expect(viewportMocks.resetSceneObjects).toHaveBeenCalledTimes(
      cleanupCountAfterInitialLoad,
    );
    expect(viewportMocks.context?.mountedObject).toBe(
      mountedObjectAfterInitialLoad,
    );
    expect(container.querySelector(".viewport-overlay")).toBeNull();
    expect(refreshedFeedback).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: "loading" }),
    );
    expect(viewportMocks.loadPreviewObject).toHaveBeenLastCalledWith(
      fileA,
      expect.anything(),
      expect.objectContaining({
        glbOverride: refreshedBuffer,
        variantSelections: [
          {
            primPath: "/Root/Asset",
            setName: "modelingVariant",
            variantName: "C",
          },
        ],
      }),
    );
    resolveRefresh({});
    await waitFor(() => {
      expect(viewportMocks.mountLoadedPreview).toHaveBeenCalledTimes(2);
    });
    expect(viewportMocks.mountLoadedPreview).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        preserveCameraView: true,
        replaceExistingPreview: true,
      }),
    );
    expect(viewportMocks.resetSceneObjects).toHaveBeenCalledTimes(
      cleanupCountAfterInitialLoad,
    );
    expect(viewportMocks.context?.mountedObject).not.toBe(
      mountedObjectAfterInitialLoad,
    );
    const cleanupCountBeforeFileChange =
      viewportMocks.resetSceneObjects.mock.calls.length;

    rerender(<AssetViewport {...makeProps(fileB, null, "C")} />);
    await waitFor(() => {
      expect(viewportMocks.resetSceneObjects.mock.calls.length).toBeGreaterThan(
        cleanupCountBeforeFileChange,
      );
    });
  });
});
