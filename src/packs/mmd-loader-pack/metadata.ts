import type { Object3D } from "three";
import type { SelectedFile } from "../../lib/files";
import type { PackMetadata } from "../../types/format-pack";
import type { MmdAssetMetadata } from "../../types/viewer";

const MMD_ASSET_METADATA_KEY = "__ywMmdAssetMetadata";

type MmdMetadataHost = Object3D & {
  userData: Object3D["userData"] & {
    [MMD_ASSET_METADATA_KEY]?: MmdAssetMetadata;
  };
};

function isMmdAssetMetadata(value: unknown): value is MmdAssetMetadata {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<MmdAssetMetadata>;
  return (
    record.format === "pmx" ||
    record.format === "pmd" ||
    record.format === "vmd"
  );
}

export function storeMmdAssetMetadata(
  object: Object3D,
  metadata: MmdAssetMetadata,
): void {
  (object as MmdMetadataHost).userData[MMD_ASSET_METADATA_KEY] = metadata;
}

export function collectMmdMetadata(
  object: Object3D,
  _file: SelectedFile,
): PackMetadata | null {
  void _file;
  const metadata = (object as MmdMetadataHost).userData[MMD_ASSET_METADATA_KEY];
  return isMmdAssetMetadata(metadata)
    ? {
        kind: "mmd",
        asset: metadata,
      }
    : null;
}
