import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Color,
  DirectionalLight,
  GridHelper,
  MOUSE,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Texture,
  Vector2,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SelectedFile } from "../lib/files";
import {
  type DisplayMode,
  type MissingReferenceError,
  type SceneContext,
  type TextureViewMode,
  type ViewerFeedback,
  type ViewerSurfaceMode,
  implementedPreviewExtensions,
  neutralFeedback,
  revokeUrls,
  disposeObject,
  stopAnimations,
  resetSceneObjects,
  applyInitialView,
  getScaleWarning,
  applyDisplayMode,
  loadPreviewObject,
  collectAssetMetadata,
  buildMissingReferenceMetadata,
  createTextureViewerObject,
  getClipLabel,
  activateClip,
  setActionPlayback,
  seekAction,
  stepAction,
  disposePreviewObject,
} from "../viewer";
import type { ViewerMode } from "../viewer";
import { AnimationBar } from "./AnimationBar";
import { emptyAssetMetadata, type AssetMetadata } from "./assetMetadata";
import { emptyAnimationState, type AnimationState } from "./animation";
import { ViewerStatePanel } from "./ViewerStatePanel";

export type { ViewerFeedback, DisplayMode, ViewerSurfaceMode, TextureViewMode };

type AssetViewportProps = {
  currentFile: SelectedFile | null;
  displayMode: DisplayMode;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  onMetadataChange: (metadata: AssetMetadata | null) => void;
  selectedTextureId: string | null;
  textureViewMode: TextureViewMode;
  viewerSurfaceMode: ViewerSurfaceMode;
  textureExposure: number;
  textureBlackPoint: number;
  textureWhitePoint: number;
  resetVersion: number;
  showGrid: boolean;
};

export function AssetViewport({
  currentFile,
  displayMode,
  onFeedbackChange,
  onMetadataChange,
  selectedTextureId,
  textureViewMode,
  viewerSurfaceMode,
  textureExposure,
  textureBlackPoint,
  textureWhitePoint,
  resetVersion,
  showGrid,
}: AssetViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneContextRef = useRef<SceneContext | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const displayModeRef = useRef(displayMode);
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(
    null,
  );
  const [overlayMode, setOverlayMode] = useState<ViewerMode>("empty");
  const [animationState, setAnimationState] =
    useState<AnimationState>(emptyAnimationState);
  const effectiveOverlayMode =
    currentFile === null
      ? "empty"
      : !implementedPreviewExtensions.has(currentFile.extension)
        ? "unsupported"
        : activePreviewPath === currentFile.path
          ? overlayMode
          : "loading";

  useEffect(() => {
    displayModeRef.current = displayMode;
  }, [displayMode]);

  useEffect(() => {
    const context = sceneContextRef.current;
    const grid = context?.scene.getObjectByName("__yw_initial_grid");
    if (grid) {
      grid.visible = showGrid;
    }
  }, [showGrid]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor("#717781");
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new Scene();
    scene.background = new Color("#717781");

    const camera = new PerspectiveCamera(
      45,
      host.clientWidth / host.clientHeight,
      0.01,
      2000,
    );
    camera.up.set(0, 1, 0);

    const pmremGenerator = new PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;

    const ambient = new AmbientLight("#ffffff", 1.8);
    const key = new DirectionalLight("#ffffff", 2.4);
    key.position.set(6, 8, 5);
    const fill = new DirectionalLight("#cfd9ea", 1.2);
    fill.position.set(-5, 3, -4);
    scene.add(ambient, key, fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.mouseButtons.LEFT = MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = MOUSE.PAN;
    controls.mouseButtons.RIGHT = MOUSE.DOLLY;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // ── Initial grid ──
    const grid = new GridHelper(10, 20, "#555b66", "#3a3f48");
    grid.name = "__yw_initial_grid";
    scene.add(grid);
    camera.position.set(5, 4, 5);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.enabled = true;

    const pointerDownHandler = (event: PointerEvent) => {
      if (!sceneContextRef.current?.mountedObject) {
        controls.enabled = false;
        return;
      }

      if (event.button === 0) {
        controls.enabled = true;
        return;
      }

      controls.enabled = event.altKey;
    };

    const pointerUpHandler = () => {
      controls.enabled = Boolean(sceneContextRef.current?.mountedObject);
    };

    renderer.domElement.addEventListener("pointerdown", pointerDownHandler);
    window.addEventListener("pointerup", pointerUpHandler);
    host.appendChild(renderer.domElement);

    const resizeObserver = new ResizeObserver(() => {
      const nextSize = new Vector2(host.clientWidth, host.clientHeight);
      renderer.setSize(nextSize.x, nextSize.y);
      camera.aspect = nextSize.x / nextSize.y;
      camera.updateProjectionMatrix();
    });

    resizeObserver.observe(host);

    let animationFrame = 0;
    const renderLoop = () => {
      animationFrame = window.requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
    };
    renderLoop();

    sceneContextRef.current = {
      renderer,
      scene,
      camera,
      controls,
      pmremGenerator,
      mountedObject: null,
      sourceObject: null,
      previewObject: null,
      cleanupUrls: [],
      mixer: null,
      clips: [],
      activeAction: null,
      textureRegistry: new Map<string, Texture>(),
    };

    onFeedbackChange(neutralFeedback);
    onMetadataChange(emptyAssetMetadata);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener(
        "pointerdown",
        pointerDownHandler,
      );
      window.removeEventListener("pointerup", pointerUpHandler);
      if (sceneContextRef.current) {
        stopAnimations(sceneContextRef.current);
        resetSceneObjects(sceneContextRef.current);
      }
      revokeUrls(sceneContextRef.current?.cleanupUrls ?? []);
      controls.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      sceneContextRef.current = null;
      resetCameraRef.current = null;
    };
  }, [onFeedbackChange, onMetadataChange]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context) {
      return;
    }

    stopAnimations(context);
    resetSceneObjects(context);
    revokeUrls(context.cleanupUrls);
    context.cleanupUrls = [];
    context.controls.enabled = false;
    resetCameraRef.current = null;

    // Show/hide initial grid based on file state
    const grid = context.scene.getObjectByName("__yw_initial_grid");

    if (!currentFile) {
      if (grid) {
        grid.visible = showGrid;
      }
      context.camera.position.set(5, 4, 5);
      context.camera.lookAt(0, 0, 0);
      context.controls.target.set(0, 0, 0);
      context.controls.enabled = true;
      onFeedbackChange(neutralFeedback);
      onMetadataChange(emptyAssetMetadata);
      return;
    }

    if (grid) {
      grid.visible = showGrid;
    }

    if (!implementedPreviewExtensions.has(currentFile.extension)) {
      onMetadataChange(emptyAssetMetadata);
      onFeedbackChange({
        mode: "unsupported",
        message: `Preview is not implemented yet for .${currentFile.extension}.`,
        warning: null,
        canResetCamera: false,
      });
      return;
    }

    let disposed = false;

    onFeedbackChange({
      mode: "loading",
      message: `Loading ${currentFile.fileName}`,
      warning: null,
      canResetCamera: false,
    });
    onMetadataChange(emptyAssetMetadata);

    loadPreviewObject(currentFile)
      .then(({ object, cleanupUrls, clips, formatVersion }) => {
        if (disposed) {
          disposeObject(object);
          revokeUrls(cleanupUrls);
          return;
        }

        context.scene.add(object);
        context.mountedObject = object;
        context.sourceObject = object;
        context.cleanupUrls = cleanupUrls;
        applyDisplayMode(object, displayModeRef.current);
        applyInitialView(context.camera, context.controls, object);
        context.controls.enabled = true;
        setActivePreviewPath(currentFile.path);
        setOverlayMode("ready");
        const metadataCollection = collectAssetMetadata(
          object,
          currentFile,
          clips,
          formatVersion,
        );
        context.textureRegistry = metadataCollection.textureRegistry;
        onMetadataChange(metadataCollection.metadata);

        context.clips = clips;
        if (clips.length > 0) {
          context.mixer = new AnimationMixer(object);
          const activated = activateClip(context, 0, true);
          setAnimationState({
            clipNames: clips.map(getClipLabel),
            activeClipIndex: activated?.clipIndex ?? 0,
            currentTime: activated?.currentTime ?? 0,
            duration: activated?.duration ?? clips[0]?.duration ?? 0,
            isPlaying: activated?.isPlaying ?? false,
          });
        } else {
          setAnimationState(emptyAnimationState);
        }

        resetCameraRef.current = () => {
          const targetObject = context.mountedObject;

          if (!targetObject) {
            return;
          }

          applyInitialView(context.camera, context.controls, targetObject);
        };

        onFeedbackChange({
          mode: "ready",
          message: `Preview ready: ${currentFile.fileName}`,
          warning: getScaleWarning(object),
          canResetCamera: true,
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to load preview.";
        const missingReferenceError = error as Partial<MissingReferenceError>;
        const mode =
          message.includes("404") || missingReferenceError.missingPaths?.length
            ? "missingReference"
            : "loadFailed";
        setActivePreviewPath(null);
        setOverlayMode(mode);
        onMetadataChange(
          mode === "missingReference" && currentFile
            ? buildMissingReferenceMetadata(
                currentFile,
                missingReferenceError.formatVersion ?? null,
                missingReferenceError.missingPaths ?? [],
                missingReferenceError.unresolvedImages ?? [],
              )
            : emptyAssetMetadata,
        );

        onFeedbackChange({
          mode,
          message,
          warning: null,
          canResetCamera: false,
        });
      });

    return () => {
      disposed = true;
      stopAnimations(context);
      resetSceneObjects(context);
      revokeUrls(context.cleanupUrls);
      context.cleanupUrls = [];
    };
  }, [currentFile, onFeedbackChange, onMetadataChange]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyDisplayMode(context.sourceObject, displayMode);
  }, [displayMode]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    if (context.previewObject) {
      context.scene.remove(context.previewObject);
      disposePreviewObject(context.previewObject);
      context.previewObject = null;
    }

    if (
      viewerSurfaceMode !== "texture" ||
      !selectedTextureId ||
      !context.textureRegistry.has(selectedTextureId)
    ) {
      context.sourceObject.visible = true;
      context.mountedObject = context.sourceObject;
      applyInitialView(context.camera, context.controls, context.sourceObject);
      return;
    }

    const selectedTexture = context.textureRegistry.get(selectedTextureId);
    if (!selectedTexture) {
      return;
    }

    const previewObject = createTextureViewerObject(
      selectedTexture,
      textureViewMode,
      textureExposure,
      textureBlackPoint,
      textureWhitePoint,
    );
    context.sourceObject.visible = false;
    context.previewObject = previewObject;
    context.mountedObject = previewObject;
    context.scene.add(previewObject);
    applyInitialView(context.camera, context.controls, previewObject);
  }, [
    selectedTextureId,
    textureBlackPoint,
    textureExposure,
    textureViewMode,
    textureWhitePoint,
    viewerSurfaceMode,
  ]);

  useEffect(() => {
    resetCameraRef.current?.();
  }, [resetVersion]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.mixer || context.clips.length === 0) {
      return;
    }

    let animationFrame = 0;
    let previousTimestamp = performance.now();

    const update = (timestamp: number) => {
      animationFrame = window.requestAnimationFrame(update);
      const deltaSeconds = (timestamp - previousTimestamp) / 1000;
      previousTimestamp = timestamp;

      if (animationState.isPlaying && viewerSurfaceMode === "asset") {
        context.mixer?.update(deltaSeconds);
      }

      const clip = context.clips[animationState.activeClipIndex];
      const action = context.activeAction;
      const nextTime = action?.time ?? 0;
      const nextDuration = clip?.duration ?? animationState.duration;

      setAnimationState((previous) => {
        if (
          previous.activeClipIndex === animationState.activeClipIndex &&
          previous.isPlaying === animationState.isPlaying &&
          Math.abs(previous.currentTime - nextTime) < 1 / 30 &&
          Math.abs(previous.duration - nextDuration) < 1 / 1000
        ) {
          return previous;
        }

        return {
          ...previous,
          currentTime: nextTime,
          duration: nextDuration,
        };
      });
    };

    animationFrame = window.requestAnimationFrame(update);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    animationState.activeClipIndex,
    animationState.duration,
    animationState.isPlaying,
    viewerSurfaceMode,
  ]);

  const hasAnimation = animationState.clipNames.length > 0;

  const handleTogglePlayback = () => {
    const context = sceneContextRef.current;
    const action = context?.activeAction;

    if (!context || !action) {
      return;
    }

    setAnimationState((previous) => {
      const nextIsPlaying = !previous.isPlaying;
      setActionPlayback(action, nextIsPlaying);
      return {
        ...previous,
        isPlaying: nextIsPlaying,
      };
    });
  };

  const handleSelectClip = (index: number) => {
    const context = sceneContextRef.current;

    if (!context || index < 0 || index >= context.clips.length) {
      return;
    }

    const activated = activateClip(context, index, animationState.isPlaying);

    if (!activated) {
      return;
    }

    setAnimationState((previous) => ({
      ...previous,
      activeClipIndex: activated.clipIndex,
      currentTime: activated.currentTime,
      duration: activated.duration,
      isPlaying: activated.isPlaying,
    }));
  };

  const handleSeek = (time: number) => {
    const context = sceneContextRef.current;
    const action = context?.activeAction;

    if (!context || !action) {
      return;
    }

    const clip = context.clips[animationState.activeClipIndex];
    const duration = clip?.duration ?? animationState.duration;
    const nextTime = seekAction(context, action, time, duration);
    setAnimationState((previous) => ({
      ...previous,
      currentTime: nextTime,
      duration,
    }));
  };

  const handleStep = (direction: -1 | 1) => {
    const context = sceneContextRef.current;
    const action = context?.activeAction;

    if (!context || !action) {
      return;
    }

    const clip = context.clips[animationState.activeClipIndex];
    const duration = clip?.duration ?? animationState.duration;
    const nextTime = stepAction(context, action, direction, duration);
    setAnimationState((previous) => ({
      ...previous,
      currentTime: nextTime,
      duration,
      isPlaying: false,
    }));
  };

  return (
    <div className="viewport-shell">
      <div className="viewport-canvas" ref={hostRef} />

      {effectiveOverlayMode !== "ready" ? (
        <div
          className={`viewport-overlay${effectiveOverlayMode === "empty" ? " is-empty" : ""}`}
        >
          <ViewerStatePanel mode={effectiveOverlayMode} />
        </div>
      ) : null}
      {hasAnimation &&
      effectiveOverlayMode === "ready" &&
      viewerSurfaceMode === "asset" ? (
        <div className="viewport-animation-overlay">
          <AnimationBar
            activeClipIndex={animationState.activeClipIndex}
            clipNames={animationState.clipNames}
            currentTime={animationState.currentTime}
            duration={animationState.duration}
            isPlaying={animationState.isPlaying}
            onSeek={handleSeek}
            onSelectClip={handleSelectClip}
            onStep={handleStep}
            onTogglePlayback={handleTogglePlayback}
          />
        </div>
      ) : null}
    </div>
  );
}
