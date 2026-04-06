import type { SelectedFile } from "../lib/files";
import type { AssetMetadata } from "./assetMetadata";

type CurrentFileCardProps = {
  currentFile: SelectedFile | null;
  metadata: AssetMetadata | null;
};

function renderValue(value: string | number | boolean | null) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value ?? "—";
}

export function CurrentFileCard({ currentFile, metadata }: CurrentFileCardProps) {
  if (!currentFile) {
    return (
      <article className="card">
        <p className="card-title">Asset</p>
        <p className="card-empty">
          No file selected. Drop a file or use File to open.
        </p>
      </article>
    );
  }

  return (
    <article className="card">
      <p className="card-title">Asset</p>

      {/* ── File info ── */}
      <div className="card-rows">
        <div className="card-row">
          <span className="card-row-label">Name</span>
          <span className="card-row-value">{currentFile.fileName}</span>
        </div>
        <div className="card-row">
          <span className="card-row-label">Type</span>
          <span className="card-row-badge">
            {currentFile.kind === "model" ? "3D Model" : "Texture"}
          </span>
        </div>
        <div className="card-row">
          <span className="card-row-label">Folder</span>
          <span className="card-row-value-mono">
            {currentFile.parentDirectory}
          </span>
        </div>
      </div>

      {/* ── Metadata ── */}
      {metadata ? (
        <>
          <div className="card-divider" />
          <div className="card-rows">
            <div className="card-row">
              <span className="card-row-label">Format</span>
              <span className="card-row-value">
                {renderValue(metadata.formatLabel)}
                {metadata.formatVersion ? (
                  <span className="card-row-badge-mono" style={{ marginLeft: 6 }}>
                    {metadata.formatVersion}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="card-row">
              <span className="card-row-label">Nodes</span>
              <span className="card-row-value-num">{renderValue(metadata.nodeCount)}</span>
            </div>
            <div className="card-row">
              <span className="card-row-label">Meshes</span>
              <span className="card-row-value-num">{renderValue(metadata.meshCount)}</span>
            </div>
            <div className="card-row">
              <span className="card-row-label">Materials</span>
              <span className="card-row-value-num">{renderValue(metadata.materialCount)}</span>
            </div>
            <div className="card-row">
              <span className="card-row-label">Textures</span>
              <span className="card-row-value-num">{renderValue(metadata.textureCount)}</span>
            </div>
            <div className="card-row">
              <span className="card-row-label">Animations</span>
              <span className={`card-row-badge ${metadata.hasAnimation ? "badge-active" : ""}`}>
                {renderValue(metadata.hasAnimation)}
              </span>
            </div>
          </div>
        </>
      ) : null}
    </article>
  );
}
