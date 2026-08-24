import { Group, PerspectiveCamera, Scene } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneContext, ViewerSurfaceMode } from "../../types/viewer";
import { mountLoadedPreview } from "../previewLoadMount";

const mountState = vi.hoisted(() => ({
  disposed: false,
  disposeDuringMetadata: false,
  disposeDuringNormalize: true,
}));

const viewerMocks = vi.hoisted(() => {
  const cleanupCallback = vi.fn();
  return {
    cleanupCallback,
    applyDisplayMode: vi.fn(),
    collectSceneTraversal: vi.fn((object: Group) => ({
      maxDimension: 1,
      meshes: [],
      objects: [object],
    })),
    disposeObject: vi.fn(),
    revokeUrls: vi.fn(),
    normalizeObjectScale: vi.fn(() => {
      if (mountState.disposeDuringNormalize) {
        mountState.disposed = true;
      }
      return {
        applied: false,
        factor: 1,
        originalMaxDimension: 1,
        normalizedMaxDimension: 1,
        originalScale: null,
      };
    }),
    collectAssetMetadata: vi.fn(() => {
      if (mountState.disposeDuringMetadata) {
        mountState.disposed = true;
      }
      return {
        metadata: {
          meshCount: 1,
          hasBones: false,
          objectInfo: {},
          hierarchy: [],
          materials: [],
          lights: [],
          cameras: [],
          animations: [],
          textures: [],
        },
        textureRegistry: new Map(),
      };
    }),
    applyDynamicGrid: vi.fn(() => ({ label: "1m" })),
    applyBoundingBoxHelpers: vi.fn(),
    applySkeletonHelpers: vi.fn(),
    applySurfaceMaterialMode: vi.fn(),
    scheduleTextureThumbnailEnrichment: vi.fn(() => ({
      cancel: vi.fn(),
    })),
    stub: vi.fn(),
  };
});

vi.mock("../../viewer", () => ({
  DEFAULT_LIGHTING_PRESET: {},
  activateClip: viewerMocks.stub,
  applyBackfaceCulling: viewerMocks.stub,
  applyBoundingBoxHelpers: viewerMocks.applyBoundingBoxHelpers,
  applyDisplayMode: viewerMocks.applyDisplayMode,
  applyDynamicAxes: viewerMocks.stub,
  applyDynamicGrid: viewerMocks.applyDynamicGrid,
  applySurfaceMaterialMode: viewerMocks.applySurfaceMaterialMode,
  applyPreviewLightingPreset: viewerMocks.stub,
  applyPreviewRenderingPreset: viewerMocks.stub,
  applyShadows: viewerMocks.stub,
  applySkeletonHelpers: viewerMocks.applySkeletonHelpers,
  applyTextureFilter: viewerMocks.stub,
  collectAssetMetadata: viewerMocks.collectAssetMetadata,
  collectSceneTraversal: viewerMocks.collectSceneTraversal,
  disposeObject: viewerMocks.disposeObject,
  getClipLabel: viewerMocks.stub,
  getObjectMaxDimension: viewerMocks.stub,
  getScaleWarning: viewerMocks.stub,
  loaderRegistry: {
    getByExtension: vi.fn(() => undefined),
  },
  normalizeObjectScale: viewerMocks.normalizeObjectScale,
  resetSceneObjects: viewerMocks.stub,
  revokeUrls: viewerMocks.revokeUrls,
  scheduleTextureThumbnailEnrichment:
    viewerMocks.scheduleTextureThumbnailEnrichment,
  stopAnimations: viewerMocks.stub,
}));

vi.mock("../../viewer/morphTargets", () => ({
  applyMorphTargetValues: viewerMocks.stub,
  morphTargetValuesForObject: vi.fn(() => ({ 0: 0.5 })),
}));

vi.mock("../../packs", () => ({
  syncMmdPreviewSpecularDirection: vi.fn(async () => undefined),
}));

vi.mock("../camera", () => ({
  frameMountedObject: viewerMocks.stub,
  findCameraBySelectionKey: vi.fn(() => null),
  syncPerspectiveCameraAspect: viewerMocks.stub,
}));

vi.mock("../selection", () => ({
  applyPurposeVisibility: viewerMocks.stub,
}));

vi.mock("../resourceDiagnostics", () => ({
  collectAssetResourceMetrics: vi.fn(() => null),
}));

function ref<T>(current: T) {
  return { current };
}

function createSceneContext() {
  const scene = new Scene();
  return {
    scene,
    renderer: {},
    camera: new PerspectiveCamera(),
    controls: { enabled: true },
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
    textureRegistry: new Map(),
    rawMaxDimension: 0,
  } as unknown as SceneContext;
}

function createMountOptions(context: SceneContext) {
  const setActivePreviewPath = vi.fn();
  const setOverlayReady = vi.fn();
  const onMetadataChange = vi.fn();
  const publishResourceDiagnostics = vi.fn();

  return {
    options: {
      clearActiveCameraId: vi.fn(),
      context,
      currentFile: {
        path: "/assets/model.glb",
        fileName: "model.glb",
        extension: "glb",
        kind: "model" as const,
        parentDirectory: "/assets",
      },
      getMountState: () => ({
        backfaceCulling: false,
        cameraSpeedMultiplier: 1,
        displayMode: "textured" as const,
        morphTargetValues: undefined as
          | Record<string, Record<number, number>>
          | undefined,
        selectedPurposeModes: undefined,
        showAxes: false,
        showBoundingBoxes: false,
        showGrid: false,
        showJointNames: false,
        showLocalAxis: false,
        showNormals: false,
        showShadows: false,
        showSkeleton: false,
        showUnlit: false,
        showVertexColors: false,
        textureFilterMode: "linear" as const,
        texturePreview3D: false,
        viewerSurfaceMode: "asset" as ViewerSurfaceMode,
      }),
      host: null,
      isDisposed: () => mountState.disposed,
      keyLight: null,
      lightingTargets: {
        ambient: null,
        key: null,
        fill: null,
      },
      refs: {
        activeCameraIdRef: ref<string | null>(null),
        activeCameraRef: ref(null),
        assetResourceMetricsRef: ref(null),
        scaleNormalizationRef: ref(null),
      },
      runtimeWarnings: [],
      update: {
        onFeedbackChange: vi.fn(),
        onGridUnitChange: vi.fn(),
        onMetadataChange,
        onPackMetadataChange: vi.fn(),
        publishResourceDiagnostics,
        setActivePreviewPath,
        setAnimationState: vi.fn(),
        setOverlayReady,
      },
    },
    spies: {
      setActivePreviewPath,
      setOverlayReady,
      onMetadataChange,
      publishResourceDiagnostics,
    },
  };
}

describe("mountLoadedPreview", () => {
  beforeEach(() => {
    mountState.disposed = false;
    mountState.disposeDuringMetadata = false;
    mountState.disposeDuringNormalize = true;
    viewerMocks.disposeObject.mockClear();
    viewerMocks.revokeUrls.mockClear();
    viewerMocks.normalizeObjectScale.mockClear();
    viewerMocks.collectAssetMetadata.mockClear();
    viewerMocks.collectSceneTraversal.mockClear();
    viewerMocks.applyDisplayMode.mockClear();
    viewerMocks.applyBoundingBoxHelpers.mockClear();
    viewerMocks.applySkeletonHelpers.mockClear();
    viewerMocks.applySurfaceMaterialMode.mockClear();
    viewerMocks.scheduleTextureThumbnailEnrichment.mockClear();
    viewerMocks.cleanupCallback.mockClear();
  });

  it("aborts late mount processing without publishing preview state when disposed during normalization", async () => {
    const object = new Group();
    const cleanupUrls = ["blob:preview-object"];
    const cleanupCallbacks = [viewerMocks.cleanupCallback];
    const context = createSceneContext();
    const { options, spies } = createMountOptions(context);

    const result = await mountLoadedPreview(
      {
        object,
        cleanupCallbacks,
        cleanupUrls,
        clips: [],
        formatVersion: null,
      },
      options,
    );

    expect(result).toBeNull();
    expect(context.scene.children).not.toContain(object);
    expect(context.mountedObject).toBeNull();
    expect(context.sourceObject).toBeNull();
    expect(context.cleanupUrls).toEqual([]);
    expect(context.cleanupCallbacks).toEqual([]);
    expect(options.refs.scaleNormalizationRef.current).toBeNull();
    expect(viewerMocks.disposeObject).toHaveBeenCalledWith(object);
    expect(viewerMocks.revokeUrls).toHaveBeenCalledWith(cleanupUrls);
    expect(viewerMocks.cleanupCallback).toHaveBeenCalledTimes(1);
    expect(spies.setActivePreviewPath).not.toHaveBeenCalled();
    expect(spies.setOverlayReady).not.toHaveBeenCalled();
    expect(spies.onMetadataChange).not.toHaveBeenCalled();
    expect(spies.publishResourceDiagnostics).not.toHaveBeenCalled();
    expect(viewerMocks.collectAssetMetadata).not.toHaveBeenCalled();
    expect(
      viewerMocks.scheduleTextureThumbnailEnrichment,
    ).not.toHaveBeenCalled();
  });

  it("does not publish active preview state when disposed during metadata collection", async () => {
    mountState.disposeDuringNormalize = false;
    mountState.disposeDuringMetadata = true;
    const object = new Group();
    const cleanupUrls = ["blob:preview-object"];
    const cleanupCallbacks = [viewerMocks.cleanupCallback];
    const context = createSceneContext();
    const { options, spies } = createMountOptions(context);

    const result = await mountLoadedPreview(
      {
        object,
        cleanupCallbacks,
        cleanupUrls,
        clips: [],
        formatVersion: null,
      },
      options,
    );

    expect(result).toBeNull();
    expect(context.scene.children).not.toContain(object);
    expect(context.mountedObject).toBeNull();
    expect(context.sourceObject).toBeNull();
    expect(context.cleanupUrls).toEqual([]);
    expect(context.cleanupCallbacks).toEqual([]);
    expect(viewerMocks.disposeObject).toHaveBeenCalledWith(object);
    expect(viewerMocks.revokeUrls).toHaveBeenCalledWith(cleanupUrls);
    expect(viewerMocks.cleanupCallback).toHaveBeenCalledTimes(1);
    expect(viewerMocks.collectAssetMetadata).toHaveBeenCalledTimes(1);
    expect(spies.setActivePreviewPath).not.toHaveBeenCalled();
    expect(spies.setOverlayReady).not.toHaveBeenCalled();
    expect(spies.onMetadataChange).not.toHaveBeenCalled();
    expect(spies.publishResourceDiagnostics).not.toHaveBeenCalled();
    expect(
      viewerMocks.scheduleTextureThumbnailEnrichment,
    ).not.toHaveBeenCalled();
  });

  it("shows skeleton helpers by default for bone-only previews", async () => {
    mountState.disposeDuringNormalize = false;
    viewerMocks.collectAssetMetadata.mockReturnValueOnce({
      metadata: {
        meshCount: 0,
        hasBones: true,
        objectInfo: {},
        hierarchy: [],
        materials: [],
        lights: [],
        cameras: [],
        animations: [],
        textures: [],
      },
      textureRegistry: new Map(),
    });
    const object = new Group();
    const context = createSceneContext();
    const { options } = createMountOptions(context);

    await mountLoadedPreview(
      {
        object,
        cleanupCallbacks: [],
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      },
      options,
    );

    expect(context.boneOnlyPreview).toBe(true);
    expect(viewerMocks.applySkeletonHelpers).toHaveBeenCalledWith(
      context.scene,
      object,
      true,
      false,
      false,
    );
  });

  it("does not mount asset helpers while texture view is active", async () => {
    mountState.disposeDuringNormalize = false;
    const object = new Group();
    const context = createSceneContext();
    const { options } = createMountOptions(context);
    options.getMountState = () => ({
      ...createMountOptions(context).options.getMountState(),
      showBoundingBoxes: true,
      showJointNames: true,
      showLocalAxis: true,
      showSkeleton: true,
      viewerSurfaceMode: "texture",
    });

    await mountLoadedPreview(
      {
        object,
        cleanupCallbacks: [],
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      },
      options,
    );

    expect(viewerMocks.applySkeletonHelpers).toHaveBeenCalledWith(
      context.scene,
      object,
      false,
      true,
      true,
    );
    expect(viewerMocks.applyBoundingBoxHelpers).toHaveBeenCalledWith(
      context.scene,
      object,
      false,
    );
  });

  it("starts standalone VMD rigs and keeps their skeleton visible", async () => {
    mountState.disposeDuringNormalize = false;
    const object = new Group();
    object.userData.motionPreviewRig = true;
    const context = createSceneContext();
    const { options } = createMountOptions(context);
    const runtime = {
      reset: vi.fn(),
      setAnimation: vi.fn(),
      tick: vi.fn(),
    };
    const animation = { metadata: { maxFrame: 60 } };

    await mountLoadedPreview(
      {
        object,
        cleanupCallbacks: [],
        cleanupUrls: [],
        clips: [],
        formatVersion: "VMD",
        mmdModel: { mesh: object, runtime },
        mmdMotion: {
          animation,
          duration: 2,
          label: "walk.vmd",
        },
      },
      options,
    );

    expect(context.boneOnlyPreview).toBe(true);
    expect(context.mmdMotion).toEqual({
      animation,
      duration: 2,
      currentTime: 0,
      label: "walk.vmd",
    });
    expect(viewerMocks.applySkeletonHelpers).toHaveBeenCalledWith(
      context.scene,
      object,
      true,
      false,
      false,
    );
    expect(options.update.setAnimationState).toHaveBeenCalledWith({
      clipNames: ["walk.vmd"],
      activeClipIndex: 0,
      currentTime: 0,
      duration: 2,
      isPlaying: true,
    });
  });

  it("applies the mounted surface mode through the viewer material API", async () => {
    mountState.disposeDuringNormalize = false;
    const object = new Group();
    const context = createSceneContext();
    const { options } = createMountOptions(context);
    options.getMountState = () => ({
      ...createMountOptions(context).options.getMountState(),
      showNormals: true,
      showUnlit: true,
      showVertexColors: true,
    });

    await mountLoadedPreview(
      {
        object,
        cleanupCallbacks: [],
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      },
      options,
    );

    expect(viewerMocks.applySurfaceMaterialMode).toHaveBeenCalledWith(
      object,
      "normals",
    );
  });

  it("reuses one load-completion traversal snapshot", async () => {
    mountState.disposeDuringNormalize = false;
    const object = new Group();
    const context = createSceneContext();
    const { options } = createMountOptions(context);

    await mountLoadedPreview(
      {
        object,
        cleanupCallbacks: [],
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      },
      options,
    );

    const traversal = viewerMocks.collectSceneTraversal.mock.results[0]?.value;
    expect(viewerMocks.collectSceneTraversal).toHaveBeenCalledOnce();
    expect(viewerMocks.normalizeObjectScale).toHaveBeenCalledWith(
      object,
      traversal,
    );
    expect(viewerMocks.applyDisplayMode).toHaveBeenCalledWith(
      object,
      "textured",
      traversal,
    );
    expect(viewerMocks.collectAssetMetadata).toHaveBeenCalledWith(
      object,
      options.currentFile,
      [],
      null,
      undefined,
      traversal,
    );
  });

  it("applies unlit on mount ahead of vertex color", async () => {
    mountState.disposeDuringNormalize = false;
    const object = new Group();
    const context = createSceneContext();
    const { options } = createMountOptions(context);
    options.getMountState = () => ({
      ...createMountOptions(context).options.getMountState(),
      showUnlit: true,
      showVertexColors: true,
    });

    await mountLoadedPreview(
      {
        object,
        cleanupCallbacks: [],
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      },
      options,
    );

    expect(viewerMocks.applySurfaceMaterialMode).toHaveBeenCalledWith(
      object,
      "unlit",
    );
  });

  it("syncs initial MMD material morph values before publishing the model", async () => {
    mountState.disposeDuringNormalize = false;
    const object = new Group();
    const syncMaterialMorphs = vi.fn();
    const context = createSceneContext();
    const { options } = createMountOptions(context);
    options.getMountState = () => ({
      ...createMountOptions(context).options.getMountState(),
      morphTargetValues: { Body: { 0: 0.5 } },
    });

    await mountLoadedPreview(
      {
        object,
        cleanupCallbacks: [],
        cleanupUrls: [],
        clips: [],
        formatVersion: "PMX 2.1",
        mmdModel: {
          mesh: object,
          syncMaterialMorphs,
        },
      },
      options,
    );

    expect(syncMaterialMorphs).toHaveBeenCalledOnce();
    expect(context.mmdModel?.syncMaterialMorphs).toBe(syncMaterialMorphs);
  });
});
