import type { RecentFilesPayload } from "../lib/recentFiles";

type RecentFilesCardProps = {
  recentFilesPayload: RecentFilesPayload | null;
  recentFilesError: string | null;
  onOpenPath: (path: string) => void;
};

export function RecentFilesCard({
  recentFilesPayload,
  recentFilesError,
  onOpenPath,
}: RecentFilesCardProps) {
  return (
    <article className="card">
      <p className="card-title">Recent Files</p>
      {recentFilesError ? (
        <p className="card-error">{recentFilesError}</p>
      ) : recentFilesPayload ? (
        <>
          <p className="card-path">{recentFilesPayload.recentFilesPath}</p>
          {recentFilesPayload.entries.length > 0 ? (
            <ul className="recent-list">
              {recentFilesPayload.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    className="recent-entry"
                    onClick={() => onOpenPath(entry.path)}
                    type="button"
                  >
                    <span className="recent-entry-path">{entry.path}</span>
                    <span className="recent-entry-meta">
                      <span className="card-row-badge">{entry.kind}</span>
                      <span>{entry.lastAccessedAt}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card-empty">No recent files recorded yet.</p>
          )}
        </>
      ) : (
        <p className="card-empty">Loading recent files.</p>
      )}
    </article>
  );
}
