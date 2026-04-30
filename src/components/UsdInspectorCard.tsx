import type {
  AssetIssue,
  StageInspection,
  StageLoadPolicy,
  StageSummary,
  VariantSelection,
} from "../lib/usd";

/** Pretty-print a numeric metadatum, falling back to "(default)" when
 * the stage didn't author the field. The fallback wording is shared
 * across timeCodesPerSecond / framesPerSecond / start/endTimeCode so
 * the metadata table reads consistently. */
function formatAuthoredNumber(value: number | null): string {
  return value === null ? "(default)" : String(value);
}

/** Strip a `file://` prefix and trim USDZ archive suffixes for display.
 * The composed-layer list returned by the backend uses Sdf identifiers
 * verbatim, which on Windows commonly shows up as
 * `file:///F:/Develop/.../foo.usda`. The inspector wants something
 * compact for humans, but we keep the original on the title so users
 * can copy the full path on hover. */
function shortLayerLabel(identifier: string): string {
  let label = identifier;
  if (label.startsWith("file:///")) {
    label = label.slice("file:///".length);
  } else if (label.startsWith("file://")) {
    label = label.slice("file://".length);
  }
  return label;
}

/** Map the stage path + binary flag to a user-facing layer-format
 * label. The backend reports `rootLayerIsBinary` as `true` for both
 * USDC and USDZ (USDZ is routed through the GLB pipeline the same
 * way), so a plain "binary → USDC" mapping mislabels USDZ archives.
 * We disambiguate via the file extension and fall back to the boolean
 * only when the extension is missing or non-standard. */
function rootLayerFormatLabel(path: string, isBinary: boolean): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".usdz")) return "USDZ (package)";
  if (lower.endsWith(".usdc")) return "USDC (binary)";
  if (lower.endsWith(".usda")) return "USDA (text)";
  if (lower.endsWith(".usd")) {
    return isBinary ? "USDC (binary)" : "USDA (text)";
  }
  return isBinary ? "binary" : "text";
}

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
  /**
   * #31: called when the user selects a different variant in the
   * inspector pulldown. The parent (App.tsx) accumulates selections
   * and re-triggers geometry extraction.
   * Only wired when the backend can enumerate variants (C++ path).
   */
  onVariantChange?: (
    primPath: string,
    setName: string,
    variantName: string,
  ) => void;
  /** #31: current variant selections mirrored from App state. Used to
   * keep the pulldowns in sync after a re-mount (e.g. file re-open). */
  variantSelections?: VariantSelection[];
};

export function UsdInspectorCard({
  summary,
  inspection,
  issues,
  loading,
  error,
  loadPolicy,
  onLoadPolicyChange,
  onVariantChange,
  variantSelections,
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
              <dt>Vertices</dt>
              <dd>{summary.totalVertices.toLocaleString()}</dd>
              <dt>Triangles</dt>
              <dd>{summary.totalTriangles.toLocaleString()}</dd>
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
              <dd>
                {summary.hasVariants ? "yes" : "no"}
                {summary.variantSetCount > 0 && (
                  <span className="muted">
                    {" "}
                    ({summary.variantSetCount} sets)
                  </span>
                )}
              </dd>
            </dl>
          )}
          {summary && summary.primTypeCounts.length > 0 && (
            <details className="card-details">
              <summary className="card-path">
                Prim Types{" "}
                <span className="muted">({summary.primTypeCounts.length})</span>
              </summary>
              <dl className="card-grid">
                {summary.primTypeCounts.map((entry) => (
                  <span key={entry.typeName} style={{ display: "contents" }}>
                    <dt>{entry.typeName}</dt>
                    <dd>{entry.count}</dd>
                  </span>
                ))}
              </dl>
            </details>
          )}
          {inspection && (
            <>
              <details className="card-details" open>
                <summary className="card-path">Metadata</summary>
                <dl className="card-grid">
                  <dt>defaultPrim</dt>
                  <dd>{inspection.defaultPrim ?? "(unset)"}</dd>
                  <dt>upAxis</dt>
                  <dd>{inspection.upAxis ?? "(default)"}</dd>
                  <dt>metersPerUnit</dt>
                  <dd>
                    {inspection.metersPerUnit !== null
                      ? inspection.metersPerUnit
                      : "(default)"}
                  </dd>
                  <dt>timeCodesPerSecond</dt>
                  <dd>{formatAuthoredNumber(inspection.timeCodesPerSecond)}</dd>
                  <dt>framesPerSecond</dt>
                  <dd>{formatAuthoredNumber(inspection.framesPerSecond)}</dd>
                  <dt>startTimeCode</dt>
                  <dd>{formatAuthoredNumber(inspection.startTimeCode)}</dd>
                  <dt>endTimeCode</dt>
                  <dd>{formatAuthoredNumber(inspection.endTimeCode)}</dd>
                  <dt>rootLayer</dt>
                  <dd>
                    {rootLayerFormatLabel(
                      inspection.path,
                      inspection.rootLayerIsBinary,
                    )}
                  </dd>
                </dl>
                {inspection.comment && (
                  <p className="card-path" style={{ whiteSpace: "pre-wrap" }}>
                    <span className="muted">comment: </span>
                    {inspection.comment}
                  </p>
                )}
              </details>
              {inspection.composedLayers.length > 0 && (
                <details className="card-details">
                  <summary className="card-path">
                    Layer Stack{" "}
                    <span className="muted">
                      ({inspection.composedLayers.length + 1})
                    </span>
                  </summary>
                  <ul className="card-list">
                    <li className="issue" title={inspection.path}>
                      <strong>root</strong>{" "}
                      <span className="muted">
                        {shortLayerLabel(inspection.path)}
                      </span>
                    </li>
                    {inspection.composedLayers.map((layer, i) => (
                      <li key={`${layer}:${i}`} className="issue" title={layer}>
                        <span className="muted">
                          ↳ {shortLayerLabel(layer)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
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
                    {inspection.variantSets.map((vs, i) => {
                      // Resolve the currently active selection: prefer
                      // the overridden value from variantSelections state
                      // (if the user already changed it), then fall back
                      // to the authored selection reported by the backend.
                      const overrideEntry = variantSelections?.find(
                        (s) =>
                          s.primPath === vs.primPath &&
                          s.setName === vs.setName,
                      );
                      // Fall back to the first available variant when no
                      // selection is authored — OpenUSD implicitly picks
                      // the first variant in that case, so mirroring that
                      // default keeps the pulldown value in sync with
                      // what the stage actually composes.
                      const activeSelection =
                        overrideEntry?.variantName ??
                        vs.selection ??
                        vs.variants[0] ??
                        "";
                      const canSwitch =
                        vs.variants.length > 0 &&
                        typeof onVariantChange === "function";
                      return (
                        <li
                          key={`${vs.primPath}:${vs.setName}:${i}`}
                          className="issue"
                        >
                          <strong>{vs.setName}</strong>
                          {canSwitch ? (
                            <>
                              {" "}
                              <select
                                className="variant-select"
                                value={activeSelection}
                                onChange={(e) =>
                                  onVariantChange(
                                    vs.primPath,
                                    vs.setName,
                                    e.target.value,
                                  )
                                }
                                title={`Switch variant set "${vs.setName}" on ${vs.primPath}`}
                              >
                                {vs.variants.map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </>
                          ) : (
                            activeSelection && (
                              <>
                                {" "}
                                ={" "}
                                <span className="badge badge-ok">
                                  {activeSelection}
                                </span>
                              </>
                            )
                          )}
                          <span className="muted"> @ {vs.primPath}</span>
                        </li>
                      );
                    })}
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
