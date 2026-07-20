declare module "three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js" {
  import type { BufferGeometry } from "three";
  import type { BVHOptions, MeshBVH } from "three-mesh-bvh";

  export class GenerateMeshBVHWorker {
    readonly running: boolean;
    generate(geometry: BufferGeometry, options?: BVHOptions): Promise<MeshBVH>;
    dispose(): void;
  }
}
