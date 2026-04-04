import type { DiagnosticsPayload } from "../lib/diagnostics";

type DiagnosticsCardProps = {
  diagnosticsPayload: DiagnosticsPayload | null;
  diagnosticsError: string | null;
};

export function DiagnosticsCard({
  diagnosticsPayload,
  diagnosticsError,
}: DiagnosticsCardProps) {
  return (
    <article className="card">
      <p className="card-title">Diagnostics</p>
      {diagnosticsError ? (
        <p className="error-text">{diagnosticsError}</p>
      ) : diagnosticsPayload ? (
        <>
          <p className="muted">{diagnosticsPayload.diagnosticsLogPath}</p>
          {diagnosticsPayload.diagnosticsSnapshot.length > 0 ? (
            <pre className="log-preview">
              {diagnosticsPayload.diagnosticsSnapshot.join("\n")}
            </pre>
          ) : (
            <p className="muted">
              No diagnostics events recorded yet for this session.
            </p>
          )}
        </>
      ) : (
        <p className="muted">Loading diagnostics log snapshot.</p>
      )}
    </article>
  );
}
