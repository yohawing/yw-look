declare module "#yw-look-spark-loader-entry" {
  import type { SelectedFile } from "../lib/files";
  import type { LoaderContext } from "../viewer/loaderRegistry";
  import type { LoadedPreview } from "../viewer/types";

  export function loadSparkPreviewObject(
    file: SelectedFile,
    context: LoaderContext,
  ): Promise<LoadedPreview>;
}
