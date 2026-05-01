import "../styles/viewport.css";

type LoadingScreenProps = {
  fileName?: string | null;
};

const consoleRows = [
  { prompt: "scan", text: "opening asset stream", state: "done" },
  { prompt: "decode", text: "resolving scene graph", state: "done" },
  { prompt: "gpu", text: "building preview buffers", state: "active" },
  { prompt: "ui", text: "syncing inspector panels", state: "pending" },
];

export function LoadingScreen({ fileName }: LoadingScreenProps) {
  const displayName = fileName ?? "Asset preview";

  return (
    <div className="loader-root" role="status" aria-live="polite">
      <section className="loader-console" aria-label="Loading asset">
        <div className="loader-console-topbar" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="loader-console-head">
          <span className="loader-console-label">Console</span>
          <strong className="loader-console-file" title={displayName}>
            {displayName}
          </strong>
        </div>
        <ol className="loader-console-lines">
          {consoleRows.map((row) => (
            <li
              className={`loader-console-line is-${row.state}`}
              key={`${row.prompt}-${row.text}`}
            >
              <span className="loader-console-prompt">{row.prompt}</span>
              <span className="loader-console-text">{row.text}</span>
            </li>
          ))}
        </ol>
        <div className="loader-console-progress" aria-hidden="true">
          <span />
        </div>
        <div className="loader-console-caret">
          <span>await preview.ready</span>
          <i aria-hidden="true" />
        </div>
      </section>
    </div>
  );
}
