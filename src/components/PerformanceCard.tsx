export type PerformanceSnapshot = {
  startupMs: number | null;
  loadMs: number | null;
  navigationMs: number | null;
};

type PerformanceCardProps = {
  snapshot: PerformanceSnapshot;
};

function formatMetric(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}

export function PerformanceCard({ snapshot }: PerformanceCardProps) {
  return (
    <article className="card">
      <p className="card-title">Performance</p>
      <div className="card-rows">
        <div className="card-row">
          <span className="card-row-label">Startup</span>
          <span className="card-row-value-mono">{formatMetric(snapshot.startupMs)}</span>
        </div>
        <div className="card-row">
          <span className="card-row-label">Latest load</span>
          <span className="card-row-value-mono">{formatMetric(snapshot.loadMs)}</span>
        </div>
        <div className="card-row">
          <span className="card-row-label">Navigation</span>
          <span className="card-row-value-mono">{formatMetric(snapshot.navigationMs)}</span>
        </div>
      </div>
    </article>
  );
}
