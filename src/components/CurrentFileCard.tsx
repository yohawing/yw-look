import type { SelectedFile } from "../lib/files";

type CurrentFileCardProps = {
  currentFile: SelectedFile | null;
};

export function CurrentFileCard({ currentFile }: CurrentFileCardProps) {
  return (
    <article className="card">
      <p className="card-title">Current File</p>
      {currentFile ? (
        <div>
          <div className="card-row">
            <span className="card-row-label">Name:</span>
            <span className="card-row-value">{currentFile.fileName}</span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Type:</span>
            <span className="card-row-value">
              {currentFile.kind === "model" ? "3D Model" : "Texture"}
            </span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Extension:</span>
            <span className="card-row-value">
              {currentFile.extension ? `.${currentFile.extension}` : "(none)"}
            </span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Folder:</span>
            <span className="card-row-value-mono">
              {currentFile.parentDirectory}
            </span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Path:</span>
            <span className="card-row-value-mono">{currentFile.path}</span>
          </div>
        </div>
      ) : (
        <p className="muted">
          No file selected. Drop a file to open.
        </p>
      )}
    </article>
  );
}
