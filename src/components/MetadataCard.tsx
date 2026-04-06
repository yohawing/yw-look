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
        <div>
          <div className="card-row">
            <span className="card-row-label">Format:</span>
            <span className="card-row-value">{renderValue(metadata.formatLabel)}</span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Version:</span>
            <span className="card-row-value">{renderValue(metadata.formatVersion)}</span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Nodes:</span>
            <span className="card-row-value">{renderValue(metadata.nodeCount)}</span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Meshes:</span>
            <span className="card-row-value">{renderValue(metadata.meshCount)}</span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Materials:</span>
            <span className="card-row-value">{renderValue(metadata.materialCount)}</span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Textures:</span>
            <span className="card-row-value">{renderValue(metadata.textureCount)}</span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Animations:</span>
            <span className="card-row-value">{renderValue(metadata.hasAnimation)}</span>
          </div>
        </div>
      ) : (
        <p className="muted">
          Open a supported file to inspect metadata.
        </p>
      )}
    </article>
  );
}
