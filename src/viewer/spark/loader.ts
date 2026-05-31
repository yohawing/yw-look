import type { SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import type { LoadedPreview } from "../types";

async function importInstalledSparkLoader() {
  return import("#yw-look-spark-loader-entry");
}

export async function loadSparkPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const { loadSparkPreviewObject: load } = await importInstalledSparkLoader();
  return load(file, context);
}
