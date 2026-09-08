import { createElement } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { SelectedFile } from "../lib/files";
import type { FormatPack } from "../types/format-pack";
import type { PackFileRequest, PackMetadata } from "../types/format-pack";
import type {
  AnimationState,
  ObjectInfo,
  SceneContext,
  ViewerFeedback,
} from "../types/viewer";
import { gaussianSplatLoaderPack } from "./gaussian-splat-loader-pack/pack";
import { ifcLoaderPack } from "./ifc-loader-pack/pack";
import {
  formatMmdMorphTargetMeta,
  getMmdBoneDetails,
} from "./mmd-loader-pack/hierarchyDetails";
import { mmdLoaderPack } from "./mmd-loader-pack/pack";
import { useMmdPackFileRequest } from "./mmd-loader-pack/runtime";
import "./mmd-loader-pack/ui/hierarchy.css";
import { vrmLoaderPack } from "./vrm-loader-pack/pack";
import { rhino3dmLoaderPack } from "./rhino3dm-loader-pack/pack";

export { loadSparkPreviewObject } from "./gaussian-splat-loader-pack/loader";
export { gaussianSplatLoaderPack } from "./gaussian-splat-loader-pack/pack";
export { ifcLoaderPack } from "./ifc-loader-pack/pack";
export {
  formatMmdMorphTargetMeta,
  getMmdBoneDetails,
  type MmdBoneDetails,
  type MmdHierarchyDetailRow,
  type MmdMorphTargetMeta,
} from "./mmd-loader-pack/hierarchyDetails";
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
export { loadRhino3dmPreviewObject } from "./rhino3dm-loader-pack/loader";
export { rhino3dmLoaderPack } from "./rhino3dm-loader-pack/pack";

export const formatPacks = [
  gaussianSplatLoaderPack,
  ifcLoaderPack,
  mmdLoaderPack,
  rhino3dmLoaderPack,
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
    case "ifc":
      return ifcLoaderPack.MetadataCard;
    case "mmd":
      return mmdLoaderPack.MetadataCard ?? null;
  }
}

export function renderMetadataCardForPackMetadata(
  metadata: PackMetadata,
  options: {
    view?: "properties" | "hierarchy";
    onSelect?: (key: string | null) => void;
  } = {},
) {
  const MetadataCard = getMetadataCardForPackMetadata(metadata);
  return MetadataCard
    ? createElement(MetadataCard, { metadata, ...options })
    : null;
}

export function getPackSelectedObjectDetails(objectInfo: ObjectInfo | null) {
  return getMmdBoneDetails(objectInfo?.mmdBone ?? null);
}

export function formatPackMorphTargetMeta(
  target: ObjectInfo["morphTargets"][number],
) {
  const meta = formatMmdMorphTargetMeta(target);
  return meta
    ? createElement("span", { title: meta.label }, meta.compact)
    : null;
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
