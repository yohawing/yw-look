import type { ViewerFeedback } from "../types/viewer";
import { optionalLoaderPackDefinitions } from "./optionalLoaderPacks";

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

export const optionalPreviewLoaders = Object.fromEntries(
  optionalLoaderPackDefinitions.flatMap((pack) =>
    pack.extensions.map((entry) => [
      entry.extension,
      {
        formatLabel: entry.formatLabel,
        loaderPackName: pack.name,
      },
    ]),
  ),
) as Record<
  string,
  {
    formatLabel: string;
    loaderPackName: string;
  }
>;

export function formatMissingOptionalLoaderMessage(extension: string) {
  const optionalLoader =
    optionalPreviewLoaders[extension as keyof typeof optionalPreviewLoaders];

  if (!optionalLoader) {
    return null;
  }

  return {
    title: `${optionalLoader.loaderPackName} is not installed.`,
    body: `Install ${optionalLoader.loaderPackName} to preview ${optionalLoader.formatLabel} files.`,
  };
}

export function formatDisabledOptionalLoaderMessage(extension: string) {
  const optionalLoader =
    optionalPreviewLoaders[extension as keyof typeof optionalPreviewLoaders];

  if (!optionalLoader) {
    return null;
  }

  return {
    title: `${optionalLoader.loaderPackName} is disabled.`,
    body: `Enable ${optionalLoader.loaderPackName} in Settings to preview ${optionalLoader.formatLabel} files.`,
  };
}

export function formatIncompatibleOptionalLoaderMessage(extension: string) {
  const optionalLoader =
    optionalPreviewLoaders[extension as keyof typeof optionalPreviewLoaders];

  if (!optionalLoader) {
    return null;
  }

  return {
    title: `${optionalLoader.loaderPackName} is not compatible with this app version.`,
    body: `Update yw-look or reinstall ${optionalLoader.loaderPackName} to preview ${optionalLoader.formatLabel} files.`,
  };
}

export function formatUnsupportedFormatMessage(extension: string) {
  const normalizedExtension = extension ? `.${extension}` : "this extension";
  return {
    title: "This file format is not supported yet.",
    body: `No preview loader is available for ${normalizedExtension}. Supported core formats include GLB, glTF, FBX, OBJ, USD, STL, PLY, DAE, PMX, PMD, VMD, SPLAT, SPZ, KSPLAT, SOG, PNG, JPG, TGA, DDS, HDR, EXR, and KTX2.`,
  };
}

export const neutralFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};
