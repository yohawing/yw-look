import type {
  AssetIssue,
  StageInspection,
  StageLoadPolicy,
  StageSummary,
} from "../lib/usd";

type UsdInspectorCardProps = {
  summary: StageSummary | null;
  inspection: StageInspection | null;
  issues: AssetIssue[];
  loading: boolean;
  error: string | null;
  /**
   * Phase 4: current load policy. `null` when no USD asset is open so
   * the segmented control can hide. When set, the control sends the
   * new value up through `onLoadPolicyChange`.
   */
  loadPolicy: StageLoadPolicy | null;
  onLoadPolicyChange: (policy: StageLoadPolicy) => void;
};

export function UsdInspectorCard({
  summary,
  inspection,
  issues,
  loading,
  error,
  loadPolicy,
  onLoadPolicyChange,
}: UsdInspectorCardProps) {
  const showControl = loadPolicy !== null;
  return (
    <article className="card">
      <header className="card-header">
        <p className="card-title">USD Inspector</p>
        {showControl && (
          <div
            className="segmented-control"
            role="group"
            aria-label="USD load policy"
          >
            <button
              type="button"
              className={`segmented-option${
                loadPolicy === "loadAll" ? " is-active" : ""
              }`}
              aria-pressed={loadPolicy === "loadAll"}
              onClick={() => onLoadPolicyChange("loadAll")}
            >
              Loaded
            </button>
            <button
              type="button"
              className={`segmented-option${
                loadPolicy === "noPayloads" ? " is-active" : ""
              }`}
              aria-pressed={loadPolicy === "noPayloads"}
              onClick={() => onLoadPolicyChange("noPayloads")}
            >
              Deferred
            </button>
          </div>
        )}
      </header>
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
              <dd>
                {summary.payloadCount}
                {summary.unloadedPayloadCount > 0 && (
                  <span className="muted">
                    {" "}
                    ({summary.unloadedPayloadCount} deferred)
                  </span>
                )}
              </dd>
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
              {inspection.variantSets.length > 0 && (
                <details className="card-details">
                  <summary className="card-path">
                    Variant Sets{" "}
                    <span className="muted">
                      ({inspection.variantSets.length})
                    </span>
                  </summary>
                  <ul className="card-list">
                    {inspection.variantSets.map((vs, i) => (
                      <li
                        key={`${vs.primPath}:${vs.setName}:${i}`}
                        className="issue"
                      >
                        <strong>{vs.setName}</strong>
                        {vs.selection && (
                          <>
                            {" "}
                            ={" "}
                            <span className="badge badge-ok">
                              {vs.selection}
                            </span>
                          </>
                        )}
                        <span className="muted"> @ {vs.primPath}</span>
                      </li>
                    ))}
                  </ul>
                </details>
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
              {issues.map((issue) => (
                <li
                  key={`${issue.code}:${issue.contextPath ?? ""}:${issue.message}`}
                  className={`issue issue-${issue.level}`}
                >
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
