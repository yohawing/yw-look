declare module "#yw-look-mmd-loader-entry" {
  import type { SelectedFile } from "../lib/files";
  import type { LoaderContext } from "../viewer/loaderRegistry";
  import type { LoadedMmdMotion, LoadedPreview } from "../viewer/types";

  export function loadMmdPreviewObject(
    file: SelectedFile,
    context: LoaderContext,
  ): Promise<LoadedPreview>;
  export function loadMmdMotion(file: SelectedFile): Promise<LoadedMmdMotion>;
}
