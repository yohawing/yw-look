import type { DirectoryListing, SelectedFile } from "../lib/files";
import { SidebarEmpty, SidebarSection } from "./sidebarPrimitives";

type FileBrowserCardProps = {
  currentFile: SelectedFile | null;
  directoryListing: DirectoryListing | null;
  onOpenPath: (path: string) => void;
};

function formatKind(file: SelectedFile) {
  if (file.extension) {
    return file.extension.toUpperCase();
  }

  return file.kind === "model" ? "3D" : file.kind.toUpperCase();
}

export function FileBrowserCard({
  currentFile,
  directoryListing,
  onOpenPath,
}: FileBrowserCardProps) {
  const files = directoryListing?.files ?? [];
  const currentPath = currentFile?.path ?? null;
  const currentDirectory = currentFile?.parentDirectory ?? null;

  return (
    <SidebarSection
      title="Browse"
      count={
        currentDirectory
          ? currentDirectory.split(/[\\/]/).filter(Boolean).slice(-1)[0]
          : undefined
      }
    >
      {currentDirectory ? (
        <p className="sidebar-path">{currentDirectory}</p>
      ) : (
        <SidebarEmpty>No folder selected.</SidebarEmpty>
      )}
      {files.length > 0 ? (
        <ul className="file-browser-list">
          {files.map((file, index) => {
            const isCurrent =
              currentPath !== null &&
              file.path.toLocaleLowerCase() === currentPath.toLocaleLowerCase();
            return (
              <li key={`${file.path}-${index}`}>
                <button
                  className={`file-browser-entry${isCurrent ? " is-current" : ""}`}
                  onClick={() => onOpenPath(file.path)}
                  type="button"
                >
                  <span className="file-browser-name">{file.fileName}</span>
                  <span className="file-browser-meta">{formatKind(file)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : currentDirectory ? (
        <SidebarEmpty>No supported siblings found.</SidebarEmpty>
      ) : null}
    </SidebarSection>
  );
}
