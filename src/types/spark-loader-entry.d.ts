declare module "#yw-look-spark-loader-entry" {
  import type { SelectedFile } from "../lib/files";
  import type { LoadedPreview, LoaderContext } from "./viewer";

  export function loadSparkPreviewObject(
    file: SelectedFile,
    context: LoaderContext,
    fileBytes?: ArrayBuffer,
  ): Promise<LoadedPreview>;
}
