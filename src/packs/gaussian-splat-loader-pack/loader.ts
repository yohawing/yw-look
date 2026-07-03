import type { SelectedFile } from "../../lib/files";
import type { LoadedPreview, LoaderContext } from "../../types/viewer";

async function importInstalledSparkLoader() {
  return import("#yw-look-spark-loader-entry");
}

export async function loadSparkPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
  fileBytes?: ArrayBuffer,
): Promise<LoadedPreview> {
  const { loadSparkPreviewObject: load } = await importInstalledSparkLoader();
  return load(file, context, fileBytes);
}
