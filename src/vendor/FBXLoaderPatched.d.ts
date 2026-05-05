import { Group, Loader, LoadingManager } from "three";

export class FBXLoader extends Loader<Group> {
  constructor(manager?: LoadingManager);
  load(
    url: string,
    onLoad: (group: Group) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void;
  parse(buffer: ArrayBuffer, path: string): Group;
  loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Group>;
}
