declare module "@moeru/three-mmd" {
  import type { LoadingManager, Loader, SkinnedMesh } from "three";

  export type MMD = {
    mesh: SkinnedMesh;
    pmx: {
      header: {
        version: number;
        modelName: string;
        englishModelName: string;
      };
    };
  };

  export class MMDLoader extends Loader<MMD> {
    constructor(plugins?: unknown[], manager?: LoadingManager);
    loadAsync(
      url: string,
      onProgress?: (event: ProgressEvent) => void,
    ): Promise<MMD>;
  }
}
