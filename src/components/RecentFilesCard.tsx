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
        <p className="error-text">{recentFilesError}</p>
      ) : recentFilesPayload ? (
        <>
          <p className="muted">{recentFilesPayload.recentFilesPath}</p>
          {recentFilesPayload.entries.length > 0 ? (
            <ul className="recent-list">
              {recentFilesPayload.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    className="recent-entry"
                    onClick={() => onOpenPath(entry.path)}
                    type="button"
                  >
                    <span>{entry.path}</span>
                    <span className="muted">
                      {entry.kind} / {entry.lastAccessedAt}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No recent files recorded yet.</p>
          )}
        </>
      ) : (
        <p className="muted">Loading recent files list.</p>
      )}
    </article>
  );
}
