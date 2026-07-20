import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { errorMessage } from "../../lib/errors";
import type {
  PackFileRequest,
  PackRuntime,
  PackRuntimeAnimationSnapshot,
} from "../../types/format-pack";
import type {
  AnimationState,
  SceneContext,
  ViewerFeedback,
} from "../../types/viewer";
import { loadMmdMotion } from "./loader";
import { syncMmdMaterialMorphRuntime } from "./materialMorph";

type UseMmdPackFileRequestOptions = {
  currentFileName?: string;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  request?: PackFileRequest | null;
  sceneContextRef: MutableRefObject<SceneContext | null>;
  setAnimationState: Dispatch<SetStateAction<AnimationState>>;
};

function snapshotForContext(
  context: SceneContext,
): PackRuntimeAnimationSnapshot | null {
  const motion = context.mmdMotion;
  if (!motion) return null;
  return {
    currentTime: motion.currentTime,
    duration: Math.max(motion.duration, 1 / 30),
  };
}

function retargetMmdMotion(context: SceneContext, seconds: number) {
  const model = context.mmdModel;
  const motion = context.mmdMotion;
  const runtime = model?.runtime;
  if (!model || !motion || !runtime) {
    return;
  }

  runtime.reset(0);
  runtime.setAnimation(motion.animation, model.mesh);
  runtime.tick(seconds, {
    mesh: model.mesh,
    ik: true,
    physics: false,
  });
  syncMmdMaterialMorphRuntime(model);
}

function setMmdMotionCurrentTime(context: SceneContext, currentTime: number) {
  if (!context.mmdMotion) {
    return;
  }
  context.mmdMotion = {
    ...context.mmdMotion,
    currentTime,
  };
}

export function createMmdRuntime(context: SceneContext): PackRuntime {
  return {
    animation: {
      hasAnimation: () =>
        Boolean(context.mmdMotion && context.mmdModel?.runtime),
      update: (deltaSeconds) => {
        if (!context.mmdMotion || !context.mmdModel?.runtime) {
          return;
        }

        const duration = Math.max(context.mmdMotion.duration, 1 / 30);
        const previousTime = context.mmdMotion.currentTime;
        const nextTime =
          (context.mmdMotion.currentTime + deltaSeconds) % duration;
        const wrapped = nextTime < previousTime;
        if (wrapped) {
          retargetMmdMotion(context, nextTime);
        } else {
          context.mmdModel.runtime.tick(nextTime, {
            mesh: context.mmdModel.mesh,
            ik: true,
            physics: false,
          });
          syncMmdMaterialMorphRuntime(context.mmdModel);
        }
        setMmdMotionCurrentTime(context, nextTime);
      },
      getSnapshot: () => snapshotForContext(context),
      seek: (time) => {
        const motion = context.mmdMotion;
        if (!motion || !context.mmdModel?.runtime) {
          return null;
        }

        const duration = Math.max(motion.duration, 1 / 30);
        const nextTime = Math.min(Math.max(time, 0), duration);
        retargetMmdMotion(context, nextTime);
        setMmdMotionCurrentTime(context, nextTime);
        return snapshotForContext(context);
      },
      step: (direction) => {
        const motion = context.mmdMotion;
        if (!motion || !context.mmdModel?.runtime) {
          return null;
        }

        const duration = Math.max(motion.duration, 1 / 30);
        const nextTime = Math.min(
          Math.max(motion.currentTime + (1 / 30) * direction, 0),
          duration,
        );
        retargetMmdMotion(context, nextTime);
        setMmdMotionCurrentTime(context, nextTime);
        return snapshotForContext(context);
      },
    },
    dispose: () => {
      context.mmdMotion = null;
    },
  };
}

export function useMmdPackFileRequest({
  currentFileName,
  onFeedbackChange,
  request,
  sceneContextRef,
  setAnimationState,
}: UseMmdPackFileRequestOptions): void {
  useEffect(() => {
    if (!request || request.action !== "apply-motion") {
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
    const motionFile = request.file;
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
        syncMmdMaterialMorphRuntime(model);

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
        const message = errorMessage(error, "Failed to load VMD motion.");
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
    onFeedbackChange,
    request,
    sceneContextRef,
    setAnimationState,
  ]);
}
