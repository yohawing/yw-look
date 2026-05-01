import type { RecentFilesPayload } from "../lib/recentFiles";
import {
  SidebarEmpty,
  SidebarError,
  SidebarSection,
} from "./sidebarPrimitives";

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
  if (recentFilesError) {
    return (
      <SidebarSection title="Recent Files">
        <SidebarError>{recentFilesError}</SidebarError>
      </SidebarSection>
    );
  }

  if (!recentFilesPayload) {
    return (
      <SidebarSection title="Recent Files">
        <SidebarEmpty>Loading recent files.</SidebarEmpty>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection
      title="Recent Files"
      count={recentFilesPayload.entries.length}
    >
      <p className="sidebar-path">{recentFilesPayload.recentFilesPath}</p>
      {recentFilesPayload.entries.length > 0 ? (
        <ul className="recent-list">
          {recentFilesPayload.entries.map((entry) => (
            <li key={entry.path}>
              <button
                className="recent-entry"
                onClick={() => onOpenPath(entry.path)}
                type="button"
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
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <SidebarEmpty>No recent files recorded yet.</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
