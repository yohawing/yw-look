import type { SelectedFile } from "../lib/files";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { useFileStore } from "../stores/fileStore";
import { FileItemList, type FileItemListEntry } from "./FileItemList";
import { SidebarEmpty, SidebarSection } from "../lib/sidebarPrimitives";

type FileBrowserCardProps = {
  onOpenPath: (path: string) => void;
  debugPanelsEnabled?: boolean;
};

function formatKind(file: SelectedFile) {
  if (file.extension) {
    return file.extension.toUpperCase();
  }

  return file.kind === "model" ? "3D" : file.kind.toUpperCase();
}

export function FileBrowserCard({
  onOpenPath,
  debugPanelsEnabled = false,
}: FileBrowserCardProps) {
  const storeCurrentFile = useFileStore((state) => state.currentFile);
  const storeDirectoryListing = useFileStore((state) => state.directoryListing);
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const currentFile = useDebugFixtures
    ? debugFixtures.debugPanelFile
    : storeCurrentFile;
  const directoryListing = useDebugFixtures
    ? debugFixtures.debugPanelDirectoryListing
    : storeDirectoryListing;
  const files = directoryListing?.files ?? [];
  const currentPath = currentFile?.path ?? null;
  const currentDirectory = currentFile?.parentDirectory ?? null;
  const fileItems: FileItemListEntry[] = files.map((file, index) => {
    const kind = formatKind(file);
    const isCurrent =
      currentPath !== null &&
      file.path.toLocaleLowerCase() === currentPath.toLocaleLowerCase();

    return {
      id: `${file.path}-${index}`,
      name: file.fileName,
      secondary: file.path,
      leading: kind.slice(0, 3),
      trailing: kind,
      selected: isCurrent,
      className: "file-browser-entry",
      onSelect: () => onOpenPath(file.path),
    };
  });

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
        <FileItemList className="file-browser-list" items={fileItems} />
      ) : currentDirectory ? (
        <SidebarEmpty>No supported siblings found.</SidebarEmpty>
      ) : null}
    </SidebarSection>
  );
}
