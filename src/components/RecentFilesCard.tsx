import type { RecentFilesPayload } from "../lib/recentFiles";
import { AsyncSidebarSection, SidebarEmpty } from "../lib/sidebarPrimitives";
import { SelectableListItem } from "./ui";

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
            <ul className="recent-list">
              {payload.entries.map((entry) => (
                <li key={entry.path}>
                  <SelectableListItem
                    className="recent-entry"
                    onClick={() => onOpenPath(entry.path)}
                  >
                    <span className="recent-entry-thumb">
                      {entry.kind.slice(0, 3).toUpperCase()}
                    </span>
                    <span className="recent-entry-info">
                      <span className="recent-entry-name">
                        {basename(entry.path)}
                      </span>
                      <span className="recent-entry-path">{entry.path}</span>
                    </span>
                    <span className="recent-entry-meta">
                      {entry.lastAccessedAt}
                    </span>
                  </SelectableListItem>
                </li>
              ))}
            </ul>
          ) : (
            <SidebarEmpty>No recent files recorded yet.</SidebarEmpty>
          )}
        </>
      )}
    </AsyncSidebarSection>
  );
}
