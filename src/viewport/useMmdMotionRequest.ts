import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { SelectedFile } from "../lib/files";
import type { AnimationState, ViewerFeedback } from "../types/viewer";
import { loadMmdMotion, type SceneContext } from "../viewer";
import { syncMmdMaterialRenderStates } from "../viewer/mmd/userData";

type MmdMotionRequest = {
  file: SelectedFile;
  version: number;
};

type UseMmdMotionRequestOptions = {
  currentFileName?: string;
  mmdMotionRequest?: MmdMotionRequest | null;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  sceneContextRef: MutableRefObject<SceneContext | null>;
  setAnimationState: Dispatch<SetStateAction<AnimationState>>;
};

export function useMmdMotionRequest({
  currentFileName,
  mmdMotionRequest,
  onFeedbackChange,
  sceneContextRef,
  setAnimationState,
}: UseMmdMotionRequestOptions): void {
  useEffect(() => {
    if (!mmdMotionRequest) {
      return;
    }

    const context = sceneContextRef.current;
    const model = context?.mmdModel;
    const runtime = model?.runtime;

    if (!context || !model || !runtime) {
      onFeedbackChange({
        mode: "loadFailed",
        message: "VMD motion was not loaded.",
        warning:
          "VMD motion can only be loaded after an MMD model with runtime support is ready.",
        canResetCamera: false,
      });
      return;
    }

    let disposed = false;
    const motionFile = mmdMotionRequest.file;
    onFeedbackChange({
      mode: "ready",
      message: `Loading MMD motion: ${motionFile.fileName}`,
      warning: null,
      canResetCamera: true,
    });

    loadMmdMotion(motionFile)
      .then((motion) => {
        if (disposed) {
          return;
        }

        runtime.setAnimation(motion.animation, model.mesh);
        runtime.tick(0, {
          mesh: model.mesh,
          ik: true,
          physics: false,
        });
        syncMmdMaterialRenderStates(model.root ?? model.mesh);

        const duration = Math.max(motion.duration, 1 / 30);
        context.mmdMotion = {
          animation: motion.animation,
          duration,
          currentTime: 0,
          label: motion.label,
        };
        setAnimationState({
          clipNames: [motion.label],
          activeClipIndex: 0,
          currentTime: 0,
          duration,
          isPlaying: true,
        });
        onFeedbackChange({
          mode: "ready",
          message: `Preview ready: ${currentFileName ?? "MMD model"}`,
          warning: null,
          canResetCamera: true,
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to load VMD motion.";
        onFeedbackChange({
          mode: "ready",
          message: `Preview ready: ${currentFileName ?? "MMD model"}`,
          warning: message,
          canResetCamera: true,
        });
      });

    return () => {
      disposed = true;
    };
  }, [
    currentFileName,
    mmdMotionRequest,
    onFeedbackChange,
    sceneContextRef,
    setAnimationState,
  ]);
}
