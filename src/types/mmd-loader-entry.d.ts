declare module "#yw-look-mmd-loader-entry" {
  import type { DirectionalLight } from "three";
  import type { SelectedFile } from "../lib/files";
  import type { LoaderContext } from "../viewer/loaderRegistry";
  import type {
    LoadedMmdMotion,
    LoadedPreview,
    MmdRuntimeModelHandle,
  } from "../viewer/types";

  export function loadMmdPreviewObject(
    file: SelectedFile,
    context: LoaderContext,
  ): Promise<LoadedPreview>;
  export function loadMmdMotionPreviewObject(
    file: SelectedFile,
    context: LoaderContext,
  ): Promise<LoadedPreview>;
  export function loadMmdMotion(file: SelectedFile): Promise<LoadedMmdMotion>;
  export function syncMmdPreviewSpecularDirection(
    mmd: MmdRuntimeModelHandle | null | undefined,
    light: DirectionalLight | null,
  ): Promise<void>;
}
