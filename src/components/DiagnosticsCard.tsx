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
        <p className="card-error">{diagnosticsError}</p>
      ) : diagnosticsPayload ? (
        <>
          <p className="card-path">{diagnosticsPayload.diagnosticsLogPath}</p>
          {diagnosticsPayload.diagnosticsSnapshot.length > 0 ? (
            <pre className="log-preview">
              {diagnosticsPayload.diagnosticsSnapshot.join("\n")}
            </pre>
          ) : (
            <p className="card-empty">
              No diagnostics events recorded yet.
            </p>
          )}
        </>
      ) : (
        <p className="card-empty">Loading diagnostics log.</p>
      )}
    </article>
  );
}
