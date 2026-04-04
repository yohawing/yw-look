import type { SelectedFile } from "../lib/files";

type CurrentFileCardProps = {
  currentFile: SelectedFile | null;
};

export function CurrentFileCard({ currentFile }: CurrentFileCardProps) {
  return (
    <article className="card">
      <p className="card-title">Current File</p>
      {currentFile ? (
        <>
          <ul>
            <li>Name: {currentFile.fileName}</li>
            <li>Kind: {currentFile.kind}</li>
            <li>Extension: {currentFile.extension || "(none)"}</li>
            <li>Folder: {currentFile.parentDirectory}</li>
          </ul>
          <p className="muted">{currentFile.path}</p>
        </>
      ) : (
        <p className="muted">
          No file selected yet. Use Open to populate the current file state.
        </p>
      )}
    </article>
  );
}
