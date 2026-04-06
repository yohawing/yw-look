export type HierarchyNode = {
  name: string;
  kind: string;
  children: HierarchyNode[];
};

export type TextureEntry = {
  id: string;
  label: string;
  channel: string;
  dimensions: string;
  thumbnailUrl: string | null;
  sourceKind:
    | "embedded"
    | "external"
    | "standalone"
    | "unresolved"
    | "unknown";
};

export type AssetMetadata = {
  formatLabel: string;
  formatVersion: string | null;
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  hasAnimation: boolean;
  hierarchy: HierarchyNode[];
  textures: TextureEntry[];
};

export const emptyAssetMetadata: AssetMetadata | null = null;
