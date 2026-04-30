import { useEffect, useState } from "react";
import {
  inspectPrim,
  type AttributeInfo,
  type MetadataEntry,
  type PrimInspection,
  type RelationshipInfo,
} from "../lib/usd";

type UsdPrimPropertyPanelProps = {
  /** Absolute path to the USD file. `null` while no USD file is open. */
  path: string | null;
  /** SdfPath of the selected prim (e.g. `"/World/Hero"`). `null` clears
   * the panel. */
  selectedPrimPath: string | null;
};

function AttributeRow({ attr }: { attr: AttributeInfo }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = attr.valueSummary.length > 40;
  return (
    <tr className="prop-table-row">
      <td className="prop-table-name" title={attr.name}>
        {attr.name}
      </td>
      <td className="prop-table-type">{attr.typeName}</td>
      <td className="prop-table-value">
        {isLong ? (
          <>
            <span>
              {expanded
                ? attr.valueSummary
                : attr.valueSummary.slice(0, 40) + "…"}
            </span>
            <button
              className="prop-expand-btn"
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse value" : "Expand value"}
            >
              {expanded ? "less" : "more"}
            </button>
          </>
        ) : (
          attr.valueSummary || <span className="muted">(none)</span>
        )}
      </td>
      <td className="prop-table-var">{attr.variability}</td>
      <td className="prop-table-custom">
        {attr.custom ? (
          <span className="prop-badge prop-badge-custom">C</span>
        ) : null}
      </td>
      <td className="prop-table-samples">
        {attr.timeSampleCount > 0 ? (
          <span className="prop-badge">{attr.timeSampleCount}s</span>
        ) : null}
      </td>
    </tr>
  );
}

function RelationshipSection({
  relationships,
}: {
  relationships: RelationshipInfo[];
}) {
  if (relationships.length === 0) return null;
  return (
    <section className="prop-section">
      <p className="prop-section-title">Relationships</p>
      <ul className="prop-rel-list">
        {relationships.map((rel) => (
          <li key={rel.name} className="prop-rel-item">
            <span className="prop-rel-name">{rel.name}</span>
            {rel.targets.length > 0 ? (
              <ul className="prop-rel-targets">
                {rel.targets.map((t, i) => (
                  <li key={`${t}:${i}`} className="prop-rel-target muted">
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted"> (no targets)</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MetadataSection({ entries }: { entries: MetadataEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="prop-section">
      <p className="prop-section-title">Metadata</p>
      <ul className="prop-meta-list">
        {entries.map((entry) => (
          <li key={entry.key} className="prop-meta-item">
            <span className="prop-meta-key">{entry.key}</span>
            <span className="prop-meta-value muted">{entry.valueSummary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function UsdPrimPropertyPanel({
  path,
  selectedPrimPath,
}: UsdPrimPropertyPanelProps) {
  const [inspection, setInspection] = useState<PrimInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // When there is no active selection reset display state and bail.
    // We schedule the reset asynchronously to satisfy the
    // react-hooks/set-state-in-effect lint rule (synchronous setState
    // in effect bodies triggers cascading renders).
    if (!path || !selectedPrimPath) {
      Promise.resolve().then(() => {
        setInspection(null);
        setError(null);
      });
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return;
        setLoading(true);
        setError(null);
        return inspectPrim(path, selectedPrimPath);
      })
      .then((result) => {
        if (!cancelled && result !== undefined) {
          setInspection(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, selectedPrimPath]);

  if (!path || !selectedPrimPath) return null;

  return (
    <article className="card prim-property-panel">
      <p className="card-title">Prim Properties</p>
      <p className="prop-prim-path muted">{selectedPrimPath}</p>

      {loading && <p className="muted">Loading…</p>}
      {error && (
        <p className="muted" title={error}>
          Inspection not available.
        </p>
      )}

      {inspection && !loading && (
        <>
          {inspection.attributes.length > 0 ? (
            <section className="prop-section">
              <p className="prop-section-title">Attributes</p>
              <div className="prop-table-wrap">
                <table className="prop-table">
                  <thead>
                    <tr>
                      <th className="prop-table-name">Name</th>
                      <th className="prop-table-type">Type</th>
                      <th className="prop-table-value">Value</th>
                      <th className="prop-table-var">Var</th>
                      <th className="prop-table-custom">C</th>
                      <th className="prop-table-samples">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspection.attributes.map((attr) => (
                      <AttributeRow key={attr.name} attr={attr} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p className="muted">No attributes authored.</p>
          )}
          <RelationshipSection relationships={inspection.relationships} />
          <MetadataSection entries={inspection.metadata} />
        </>
      )}
    </article>
  );
}
