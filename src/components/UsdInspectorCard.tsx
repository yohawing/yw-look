import type { AssetIssue, StageInspection, StageSummary } from "../lib/usd";

type UsdInspectorCardProps = {
  summary: StageSummary | null;
  inspection: StageInspection | null;
  issues: AssetIssue[];
  loading: boolean;
  error: string | null;
};

export function UsdInspectorCard({
  summary,
  inspection,
  issues,
  loading,
  error,
}: UsdInspectorCardProps) {
  return (
    <article className="card">
      <p className="card-title">USD Inspector</p>
      {error ? (
        <p className="card-error">{error}</p>
      ) : loading ? (
        <p className="card-empty">Inspecting stage…</p>
      ) : !summary && !inspection ? (
        <p className="card-empty">
          Open a USD/USDA/USDC/USDZ asset to inspect its stage.
        </p>
      ) : (
        <>
          {summary && (
            <dl className="card-grid">
              <dt>Layers</dt>
              <dd>{summary.layerCount}</dd>
              <dt>Root prims</dt>
              <dd>{summary.rootPrimCount}</dd>
              <dt>Meshes</dt>
              <dd>{summary.meshCount}</dd>
              <dt>Payloads</dt>
              <dd>{summary.payloadCount}</dd>
              <dt>Variants</dt>
              <dd>{summary.hasVariants ? "yes" : "no"}</dd>
            </dl>
          )}
          {inspection && (
            <>
              {inspection.defaultPrim && (
                <p className="card-path">
                  defaultPrim: {inspection.defaultPrim}
                </p>
              )}
              {inspection.upAxis && (
                <p className="card-path">upAxis: {inspection.upAxis}</p>
              )}
              {inspection.missingAssets.length > 0 && (
                <p className="card-error">
                  Missing assets: {inspection.missingAssets.length}
                </p>
              )}
            </>
          )}
          {issues.length > 0 && (
            <ul className="card-list">
              {issues.map((issue, idx) => (
                <li key={idx} className={`issue issue-${issue.level}`}>
                  <strong>{issue.code}</strong>: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
