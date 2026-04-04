import type { AssetMetadata } from "./assetMetadata";

type MetadataCardProps = {
  metadata: AssetMetadata | null;
};

function renderValue(value: string | number | boolean | null) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value ?? "n/a";
}

export function MetadataCard({ metadata }: MetadataCardProps) {
  return (
    <article className="card">
      <p className="card-title">Asset Metadata</p>
      {metadata ? (
        <ul>
          <li>Format: {renderValue(metadata.formatLabel)}</li>
          <li>Version: {renderValue(metadata.formatVersion)}</li>
          <li>Nodes: {renderValue(metadata.nodeCount)}</li>
          <li>Meshes: {renderValue(metadata.meshCount)}</li>
          <li>Materials: {renderValue(metadata.materialCount)}</li>
          <li>Textures: {renderValue(metadata.textureCount)}</li>
          <li>Animations: {renderValue(metadata.hasAnimation)}</li>
        </ul>
      ) : (
        <p className="muted">
          Open a supported file to inspect basic metadata and scene statistics.
        </p>
      )}
    </article>
  );
}
