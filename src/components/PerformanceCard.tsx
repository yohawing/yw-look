export type PerformanceSnapshot = {
  startupMs: number | null;
  loadMs: number | null;
  navigationMs: number | null;
};

type PerformanceCardProps = {
  snapshot: PerformanceSnapshot;
};

function formatMetric(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(1)} ms`;
}

export function PerformanceCard({ snapshot }: PerformanceCardProps) {
  return (
    <article className="card">
      <p className="card-title">Performance</p>
      <ul>
        <li>Startup: {formatMetric(snapshot.startupMs)}</li>
        <li>Latest load: {formatMetric(snapshot.loadMs)}</li>
        <li>Latest navigation: {formatMetric(snapshot.navigationMs)}</li>
      </ul>
      <p className="muted">
        Measurements are captured in the renderer for startup, asset load, and
        folder navigation.
      </p>
    </article>
  );
}
