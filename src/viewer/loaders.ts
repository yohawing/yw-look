import type { SelectedFile } from "../lib/files";
import {
  loadMmdMotion as loadMmdMotionFromPack,
  registerFormatPacks,
} from "../packs";
import type { FormatPack } from "../types/format-pack";
import type { OptionalLoaderPackManifest } from "../types/ipc";
import {
  coreLoaderExtensions,
  loadCorePreviewObject,
} from "./corePreviewLoader";
import { LoaderRegistry, type LoaderContext } from "./loaderRegistry";
import { getOptionalLoaderDefinitionByExtension } from "./optionalLoaderPacks";
import {
  isOptionalLoaderPackDisabled,
  summarizeOptionalLoaderPacks as summarizeOptionalLoaderPacksImpl,
} from "./optionalLoaderPackStatus";
import type {
  LoadedPreview,
  OptionalLoaderPackStatus,
  PreviewSupportState,
} from "./types";

export type LoadMmdMotionOptions = {
  signal?: AbortSignal;
};

export async function loadMmdMotion(
  file: SelectedFile,
  options?: LoadMmdMotionOptions,
) {
  return loadMmdMotionFromPack(file, options);
}

export {
  disabledOptionalLoaderPackIds,
  incompatibleOptionalLoaderPackIds,
  summarizeOptionalLoaderPacks,
} from "./optionalLoaderPackStatus";

export const loaderRegistry = new LoaderRegistry();

loaderRegistry.register({
  id: "core-preview-loader",
  name: "Core Preview Loader",
  extensions: coreLoaderExtensions,
  loadPreviewObject: loadCorePreviewObject,
} satisfies FormatPack);

registerFormatPacks(loaderRegistry);

export function listRegisteredLoaders() {
  return loaderRegistry.list();
}

export function getPreviewSupportState(
  extension: string,
  options: {
    disabledOptionalLoaderPackIds?: readonly string[] | ReadonlySet<string>;
    incompatibleOptionalLoaderPackIds?: readonly string[] | ReadonlySet<string>;
    optionalLoaderInstalled?: boolean;
  } = {},
): PreviewSupportState {
  const normalizedExtension = extension.toLowerCase();
  const loader = loaderRegistry.getByExtension(normalizedExtension);

  if (loader) {
    if (
      loader.optional === true &&
      (loader.installed === false || options.optionalLoaderInstalled === false)
    ) {
      return "missingOptionalLoader";
    }

    if (
      loader.optional === true &&
      isOptionalLoaderPackDisabled(
        loader.id,
        options.incompatibleOptionalLoaderPackIds,
      )
    ) {
      return "incompatibleOptionalLoader";
    }

    if (
      loader.optional === true &&
      isOptionalLoaderPackDisabled(
        loader.id,
        options.disabledOptionalLoaderPackIds,
      )
    ) {
      return "disabledOptionalLoader";
    }

    return "implemented";
  }

  if (getOptionalLoaderDefinitionByExtension(normalizedExtension)) {
    return "missingOptionalLoader";
  }

  return "unsupported";
}

export function listOptionalLoaderPacks(
  settings?: Record<string, { enabled?: boolean } | undefined>,
  manifests: readonly OptionalLoaderPackManifest[] = [],
): OptionalLoaderPackStatus[] {
  return summarizeOptionalLoaderPacksImpl(
    loaderRegistry.list(),
    settings,
    manifests,
  );
}

export async function loadPreviewObject(
  file: SelectedFile,
  renderer?: import("three").WebGLRenderer,
  options: LoaderContext = {},
): Promise<LoadedPreview> {
  const loader = loaderRegistry.getByExtension(file.extension);
  if (
    !loader ||
    loader.installed === false ||
    (loader.optional === true &&
      (isOptionalLoaderPackDisabled(
        loader.id,
        options.disabledOptionalLoaderPackIds,
      ) ||
        isOptionalLoaderPackDisabled(
          loader.id,
          options.incompatibleOptionalLoaderPackIds,
        )))
  ) {
    throw new Error(`Preview loader is not installed for .${file.extension}`);
  }

  return loader.loadPreviewObject(file, {
    ...options,
    renderer,
  });
}
