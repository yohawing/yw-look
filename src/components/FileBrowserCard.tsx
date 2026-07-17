import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { formatFileKindLabel } from "../lib/fileKindLabel";
import { useFileStore } from "../stores/fileStore";
import { FileItemList, type FileItemListEntry } from "./FileItemList";
import { SidebarEmpty, SidebarSection } from "../lib/sidebarPrimitives";

type FileBrowserCardProps = {
  onOpenPath: (path: string) => void;
  debugPanelsEnabled?: boolean;
};

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
    const isCurrent =
      currentPath !== null &&
      file.path.toLocaleLowerCase() === currentPath.toLocaleLowerCase();

    return {
      id: `${file.path}-${index}`,
      name: file.fileName,
      leading: formatFileKindLabel(file.kind),
      tooltip: file.path,
      selected: isCurrent,
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
        <FileItemList items={fileItems} />
      ) : currentDirectory ? (
        <SidebarEmpty>No supported siblings found.</SidebarEmpty>
      ) : null}
    </SidebarSection>
  );
}
