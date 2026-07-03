import { createElement } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { SelectedFile } from "../lib/files";
import type { FormatPack } from "../types/format-pack";
import type { PackFileRequest, PackMetadata } from "../types/format-pack";
import type {
  AnimationState,
  SceneContext,
  ViewerFeedback,
} from "../types/viewer";
import { gaussianSplatLoaderPack } from "./gaussian-splat-loader-pack/pack";
import { mmdLoaderPack } from "./mmd-loader-pack/pack";
import { useMmdPackFileRequest } from "./mmd-loader-pack/runtime";
import "./mmd-loader-pack/ui/hierarchy.css";
import { vrmLoaderPack } from "./vrm-loader-pack/pack";

export { loadSparkPreviewObject } from "./gaussian-splat-loader-pack/loader";
export { gaussianSplatLoaderPack } from "./gaussian-splat-loader-pack/pack";
export {
  loadMmdMotion,
  loadMmdMotionPreviewObject,
  loadMmdPreviewObject,
  syncMmdPreviewSpecularDirection,
} from "./mmd-loader-pack/loader";
export { mmdLoaderPack } from "./mmd-loader-pack/pack";
export {
  createMmdRuntime,
  useMmdPackFileRequest,
} from "./mmd-loader-pack/runtime";
export {
  copyMmdMaterialUserData,
  isInternalMmdProxyObject,
  isMmdOutlineMaterial,
  isMmdOutlineProxyObject,
  syncMmdMaterialRenderStates,
  syncMmdTransparentMaterialRenderState,
} from "./mmd-loader-pack/userData";
export { vrmLoaderPack } from "./vrm-loader-pack/pack";

export const formatPacks = [
  gaussianSplatLoaderPack,
  mmdLoaderPack,
  vrmLoaderPack,
] as const;

type FormatPackRegistry = {
  register(pack: FormatPack): void;
};

export function registerFormatPacks(registry: FormatPackRegistry): void {
  for (const pack of formatPacks) {
    registry.register(pack);
  }
}

export function getMetadataCardForPackMetadata(metadata: PackMetadata) {
  switch (metadata.kind) {
    case "mmd":
      return mmdLoaderPack.MetadataCard ?? null;
  }
}

export function renderMetadataCardForPackMetadata(metadata: PackMetadata) {
  const MetadataCard = getMetadataCardForPackMetadata(metadata);
  return MetadataCard ? createElement(MetadataCard, { metadata }) : null;
}

export function createPackFileRequest(
  file: SelectedFile,
  context: {
    currentFile: SelectedFile | null;
    version: number;
  },
): PackFileRequest | null {
  for (const pack of formatPacks as readonly FormatPack[]) {
    const request = pack.createFileRequest?.(file, context);
    if (request) {
      return request;
    }
  }
  return null;
}

type UsePackFileRequestOptions = {
  currentFileName?: string;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  request?: PackFileRequest | null;
  sceneContextRef: MutableRefObject<SceneContext | null>;
  setAnimationState: Dispatch<SetStateAction<AnimationState>>;
};

export function usePackFileRequest({
  currentFileName,
  onFeedbackChange,
  request,
  sceneContextRef,
  setAnimationState,
}: UsePackFileRequestOptions): void {
  useMmdPackFileRequest({
    currentFileName,
    onFeedbackChange,
    request: request?.packId === mmdLoaderPack.id ? request : null,
    sceneContextRef,
    setAnimationState,
  });
}
