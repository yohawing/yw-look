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
      {(payload) => (
        <>
          <p className="sidebar-path">{payload.recentFilesPath}</p>
          {payload.entries.length > 0 ? (
            <FileItemList
              className="recent-list"
              items={payload.entries.map(
                (entry): FileItemListEntry => ({
                  id: entry.path,
                  name: basename(entry.path),
                  secondary: entry.path,
                  leading: entry.kind.slice(0, 3).toUpperCase(),
                  trailing: entry.lastAccessedAt,
                  className: "recent-entry",
                  onSelect: () => onOpenPath(entry.path),
                }),
              )}
            />
          ) : (
            <SidebarEmpty>No recent files recorded yet.</SidebarEmpty>
          )}
        </>
      )}
    </AsyncSidebarSection>
  );
}
