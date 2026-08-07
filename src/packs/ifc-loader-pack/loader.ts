import type { SelectedFile } from "../../lib/files";
import type { LoadedPreview, LoaderContext } from "../../types/viewer";

async function importInstalledIfcLoader() {
  return import("#yw-look-ifc-loader-entry");
}

export async function loadIfcPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const { loadIfcPreviewObject: load } = await importInstalledIfcLoader();
  return load(file, context);
}
