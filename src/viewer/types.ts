import type { ViewerFeedback } from "../types/viewer";
import { getOptionalLoaderMessageInfo } from "./optionalLoaderPacks";

export type {
  ViewerMode,
  ViewerFeedback,
  DisplayMode,
  ViewerSurfaceMode,
  TextureViewMode,
  SceneContext,
  MmdAnimationHandle,
  MmdRuntimeModelHandle,
  MmdMotionPlayback,
  LoadedPreview,
  ViewerAssetKind,
  LoadedMmdMotion,
  DeferredTextureSnapshot,
  LoadingStageId,
  LoadingStageReporter,
  LoadingStageSnapshot,
  TextureBundle,
  TextureSlotKey,
  TexturedMaterial,
  MissingReferenceError,
  PreviewSupportState,
  OptionalLoaderPackStatus,
  RegisteredLoaderInfo,
} from "../types/viewer";

export function formatMissingOptionalLoaderMessage(extension: string) {
  const optionalLoader = getOptionalLoaderMessageInfo(extension);

  if (!optionalLoader) {
    return null;
  }

  return {
    title: `${optionalLoader.loaderPackName} is not installed.`,
    body: `Install ${optionalLoader.loaderPackName} to preview ${optionalLoader.formatLabel} files.`,
  };
}

export function formatDisabledOptionalLoaderMessage(extension: string) {
  const optionalLoader = getOptionalLoaderMessageInfo(extension);

  if (!optionalLoader) {
    return null;
  }

  return {
    title: `${optionalLoader.loaderPackName} is disabled.`,
    body: `Enable ${optionalLoader.loaderPackName} in Settings to preview ${optionalLoader.formatLabel} files.`,
  };
}

export function formatIncompatibleOptionalLoaderMessage(extension: string) {
  const optionalLoader = getOptionalLoaderMessageInfo(extension);

  if (!optionalLoader) {
    return null;
  }

  return {
    title: `${optionalLoader.loaderPackName} is not compatible with this app version.`,
    body: `Update yw-look or reinstall ${optionalLoader.loaderPackName} to preview ${optionalLoader.formatLabel} files.`,
  };
}

export function formatUnsupportedFormatMessage(
  extension: string,
  supportedExtensions: readonly string[] = [],
) {
  const normalizedExtension = extension ? `.${extension}` : "this extension";
  const supportedList = formatSupportedExtensionList(supportedExtensions);
  return {
    title: "This file format is not supported yet.",
    body: `No preview loader is available for ${normalizedExtension}.${
      supportedList ? ` Supported formats include ${supportedList}.` : ""
    }`,
  };
}

export function formatSupportedExtensionList(extensions: readonly string[]) {
  const labels = [...new Set(extensions.map((extension) => extension.trim()))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((extension) => extension.toUpperCase());

  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export const neutralFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};
