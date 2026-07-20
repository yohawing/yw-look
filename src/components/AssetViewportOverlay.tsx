import type { RefObject } from "react";
import type { SelectedFile } from "../lib/files";
import type { ViewerMode } from "../viewer";
import { AnimationBar } from "./AnimationBar";
import type { AnimationState } from "./animation";
import { LoadingScreen } from "./LoadingScreen";
import { ViewerStatePanel } from "./ViewerStatePanel";
import type { DeferredTextureSnapshot, LoadingStageSnapshot } from "../viewer";
import type { ViewerSurfaceMode } from "../types/viewer";

type AssetViewportOverlayProps = {
  currentFile: SelectedFile | null;
  deferredTexture: DeferredTextureSnapshot | null;
  effectiveDeferredProgress: DeferredTextureSnapshot | null;
  effectiveOverlayMode: ViewerMode;
  errorDetail: string | null;
  loadingStage: LoadingStageSnapshot | null;
  onOpenFile?: () => void;
  showRendererStats: boolean;
  statsRef: RefObject<HTMLDivElement | null>;
  viewerSurfaceMode: ViewerSurfaceMode;
  animationState: AnimationState;
  hasAnimation: boolean;
  onSeek: (time: number) => void;
  onSelectClip: (index: number) => void;
  onStep: (direction: -1 | 1) => void;
  onTogglePlayback: () => void;
};

export function AssetViewportOverlay({
  currentFile,
  deferredTexture,
  effectiveDeferredProgress,
  effectiveOverlayMode,
  errorDetail,
  loadingStage,
  onOpenFile,
  showRendererStats,
  statsRef,
  viewerSurfaceMode,
  animationState,
  hasAnimation,
  onSeek,
  onSelectClip,
  onStep,
  onTogglePlayback,
}: AssetViewportOverlayProps) {
  return (
    <>
      <div
        className="viewport-stats"
        ref={statsRef}
        hidden={!showRendererStats}
        aria-hidden={!showRendererStats}
      />

      {effectiveOverlayMode !== "ready" ? (
        <div
          className={`viewport-overlay${effectiveOverlayMode === "empty" ? " is-empty" : ""}`}
        >
          <ViewerStatePanel
            deferredTexture={deferredTexture}
            detailMessage={errorDetail}
            fileExtension={currentFile?.extension}
            fileName={currentFile?.fileName}
            loadingStage={loadingStage}
            mode={effectiveOverlayMode}
            onOpenFile={onOpenFile}
          />
        </div>
      ) : null}
      {effectiveOverlayMode === "ready" &&
      viewerSurfaceMode === "asset" &&
      effectiveDeferredProgress ? (
        <div className="viewport-deferred-console">
          <LoadingScreen
            compact
            deferredTexture={effectiveDeferredProgress}
            fileName={currentFile?.fileName}
          />
        </div>
      ) : null}
      {hasAnimation &&
      effectiveOverlayMode === "ready" &&
      viewerSurfaceMode === "asset" ? (
        <div className="viewport-animation-overlay u-absolute u-flex u-justify-center">
          <AnimationBar
            activeClipIndex={animationState.activeClipIndex}
            clipNames={animationState.clipNames}
            currentTime={animationState.currentTime}
            duration={animationState.duration}
            isPlaying={animationState.isPlaying}
            onSeek={onSeek}
            onSelectClip={onSelectClip}
            onStep={onStep}
            onTogglePlayback={onTogglePlayback}
          />
        </div>
      ) : null}
    </>
  );
}
