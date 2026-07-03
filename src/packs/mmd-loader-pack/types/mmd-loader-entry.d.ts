declare module "#yw-look-mmd-loader-entry" {
  import type { DirectionalLight } from "three";
  import type { SelectedFile } from "../../../lib/files";
  import type {
    LoadedMmdMotion,
    LoadedPreview,
    LoaderContext,
    MmdRuntimeModelHandle,
  } from "../../../types/viewer";

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
