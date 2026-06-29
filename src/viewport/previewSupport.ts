import type {
  PreviewSupportState,
  SceneContext,
  ViewerMode,
} from "../types/viewer";
import { getPreviewSupportState, listRegisteredLoaders } from "../viewer";
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
