import type { RecentFilesPayload } from "../lib/recentFiles";
import { AsyncSidebarSection, SidebarEmpty } from "../lib/sidebarPrimitives";
import { FileItemList, type FileItemListEntry } from "./FileItemList";

type RecentFilesCardProps = {
  recentFilesPayload: RecentFilesPayload | null;
  recentFilesError: string | null;
  onOpenPath: (path: string) => void;
};

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function kindLabel(kind: string) {
  switch (kind.toLowerCase()) {
    case "model":
      return "Model";
    case "texture":
      return "Texture";
    case "motion":
      return "Motion";
    default:
      return kind;
  }
}

export function RecentFilesCard({
  recentFilesPayload,
  recentFilesError,
  onOpenPath,
}: RecentFilesCardProps) {
  return (
    <AsyncSidebarSection
      title="Recent Files"
      error={recentFilesError}
      data={recentFilesPayload}
      loadingLabel="Loading recent files."
      count={(payload) => payload.entries.length}
    >
      {(payload) =>
        payload.entries.length > 0 ? (
          <FileItemList
            className="recent-list"
            items={payload.entries.map(
              (entry): FileItemListEntry => ({
                id: entry.path,
                name: basename(entry.path),
                leading: kindLabel(entry.kind),
                tooltip: entry.path,
                className: "recent-entry",
                onSelect: () => onOpenPath(entry.path),
              }),
            )}
          />
        ) : (
          <SidebarEmpty>No recent files recorded yet.</SidebarEmpty>
        )
      }
    </AsyncSidebarSection>
  );
}
