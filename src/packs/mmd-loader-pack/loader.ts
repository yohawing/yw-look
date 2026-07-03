import type { DirectionalLight } from "three";
import type { SelectedFile } from "../../lib/files";
import type {
  LoadedMmdMotion,
  LoadedPreview,
  LoaderContext,
  MmdRuntimeModelHandle,
} from "../../types/viewer";

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

export async function loadMmdMotionPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const { loadMmdMotionPreviewObject: load } = await importInstalledMmdLoader();
  return load(file, context);
}

export async function loadMmdMotion(
  file: SelectedFile,
): Promise<LoadedMmdMotion> {
  const { loadMmdMotion: load } = await importInstalledMmdLoader();
  return load(file);
}

export async function syncMmdPreviewSpecularDirection(
  mmd: MmdRuntimeModelHandle | null | undefined,
  light: DirectionalLight | null,
) {
  const { syncMmdPreviewSpecularDirection: sync } =
    await importInstalledMmdLoader();
  return sync(mmd, light);
}
