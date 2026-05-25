import type { SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import type { LoadedMmdMotion, LoadedPreview } from "../types";

async function importInstalledMmdLoader() {
  return import("#yw-look-mmd-loader-entry");
}

export async function loadMmdPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const { loadMmdPreviewObject: load } = await importInstalledMmdLoader();
  return load(file, context);
}

export async function loadMmdMotion(
  file: SelectedFile,
): Promise<LoadedMmdMotion> {
  const { loadMmdMotion: load } = await importInstalledMmdLoader();
  return load(file);
}
