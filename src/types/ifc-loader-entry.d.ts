declare module "#yw-look-ifc-loader-entry" {
  import type { SelectedFile } from "../lib/files";
  import type { LoadedPreview, LoaderContext } from "./viewer";

  export function loadIfcPreviewObject(
    file: SelectedFile,
    context: LoaderContext,
  ): Promise<LoadedPreview>;
}

declare module "@thatopen/fragments/worker?url" {
  const url: string;
  export default url;
}

declare module "web-ifc/web-ifc.wasm?url" {
  const url: string;
  export default url;
}
