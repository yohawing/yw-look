import type {
  PreviewSupportState,
  SceneContext,
  ViewerFeedback,
  ViewerMode,
} from "../types/viewer";
import {
  formatDisabledOptionalLoaderMessage,
  formatIncompatibleOptionalLoaderMessage,
  formatMissingOptionalLoaderMessage,
  formatUnsupportedFormatMessage,
  getPreviewSupportState,
  listRegisteredLoaders,
} from "../viewer";
import type { RuntimePreviewUpdater } from "./types";

export const supportedPreviewExtensions = listRegisteredLoaders().map(
  (loader) => loader.extension,
);

function isRuntimePreviewUpdater(
  value: unknown,
): value is RuntimePreviewUpdater {
  return (
    typeof value === "object" &&
    value !== null &&
    "update" in value &&
    typeof value.update === "function"
  );
}

export function updateRuntimePreview(
  context: SceneContext | null,
  deltaSeconds: number,
) {
  const updater = context?.sourceObject?.userData.vrm;
  if (isRuntimePreviewUpdater(updater)) {
    updater.update(deltaSeconds);
  }
}

export function getRuntimePreviewSupportState(
  extension: string,
  disabledOptionalLoaderPackIds: readonly string[],
  incompatibleOptionalLoaderPackIds: readonly string[],
) {
  const loader = listRegisteredLoaders().find(
    (entry) => entry.extension === extension,
  );
  return getPreviewSupportState(extension, {
    disabledOptionalLoaderPackIds,
    incompatibleOptionalLoaderPackIds,
    optionalLoaderInstalled: loader?.installed !== false,
  });
}

export function resolveEffectiveOverlayMode({
  currentFilePath,
  previewSupportState,
  activePreviewPath,
  overlayMode,
}: {
  currentFilePath: string | null;
  previewSupportState: PreviewSupportState;
  activePreviewPath: string | null;
  overlayMode: ViewerMode;
}): ViewerMode {
  if (currentFilePath === null) {
    return "empty";
  }

  if (
    previewSupportState === "missingOptionalLoader" ||
    previewSupportState === "disabledOptionalLoader" ||
    previewSupportState === "incompatibleOptionalLoader" ||
    previewSupportState === "unsupported"
  ) {
    return previewSupportState;
  }

  return activePreviewPath === currentFilePath ? overlayMode : "loading";
}

export function buildUnsupportedPreviewFeedback(
  extension: string,
  supportState: Exclude<PreviewSupportState, "implemented">,
): ViewerFeedback {
  const message =
    supportState === "missingOptionalLoader"
      ? formatMissingOptionalLoaderMessage(extension)
      : supportState === "disabledOptionalLoader"
        ? formatDisabledOptionalLoaderMessage(extension)
        : supportState === "incompatibleOptionalLoader"
          ? formatIncompatibleOptionalLoaderMessage(extension)
          : formatUnsupportedFormatMessage(
              extension,
              supportedPreviewExtensions,
            );

  return {
    mode: supportState,
    message:
      message !== null
        ? `${message.title} ${message.body}`
        : `Preview is not implemented yet for .${extension}.`,
    warning: null,
    canResetCamera: false,
  };
}
