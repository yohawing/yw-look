import { t } from "../lib/i18n";
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
  PreviewWarning,
  PreviewLoadStats,
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
export { formatPreviewWarning } from "../types/viewer";
export type {
  FormatPack,
  PackMetadata,
  PackRuntime,
} from "../types/format-pack";

export function formatMissingOptionalLoaderMessage(extension: string) {
  const optionalLoader = getOptionalLoaderMessageInfo(extension);

  if (!optionalLoader) {
    return null;
  }

  return {
    title: t("loader.notInstalled", {
      pack: optionalLoader.loaderPackName,
      format: optionalLoader.formatLabel,
    }),
    body: t("loader.install", {
      pack: optionalLoader.loaderPackName,
      format: optionalLoader.formatLabel,
    }),
  };
}

export function formatDisabledOptionalLoaderMessage(extension: string) {
  const optionalLoader = getOptionalLoaderMessageInfo(extension);

  if (!optionalLoader) {
    return null;
  }

  return {
    title: t("loader.disabled", {
      pack: optionalLoader.loaderPackName,
      format: optionalLoader.formatLabel,
    }),
    body: t("loader.enable", {
      pack: optionalLoader.loaderPackName,
      format: optionalLoader.formatLabel,
    }),
  };
}

export function formatIncompatibleOptionalLoaderMessage(extension: string) {
  const optionalLoader = getOptionalLoaderMessageInfo(extension);

  if (!optionalLoader) {
    return null;
  }

  return {
    title: t("loader.incompatible", {
      pack: optionalLoader.loaderPackName,
      format: optionalLoader.formatLabel,
    }),
    body: t("loader.update", {
      pack: optionalLoader.loaderPackName,
      format: optionalLoader.formatLabel,
    }),
  };
}

export function formatUnsupportedFormatMessage(
  extension: string,
  supportedExtensions: readonly string[] = [],
) {
  const normalizedExtension = extension
    ? `.${extension}`
    : t("format.extension");
  const supportedList = formatSupportedExtensionList(supportedExtensions);
  return {
    title: t("format.unsupported"),
    body:
      t("format.noLoader", { extension: normalizedExtension }) +
      (supportedList ? t("format.supported", { formats: supportedList }) : ""),
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
