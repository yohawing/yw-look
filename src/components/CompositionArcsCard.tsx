import { useMemo } from "react";
import type { CompositionArc, StageInspection } from "../lib/usd";

type CompositionArcsCardProps = {
  inspection: StageInspection | null;
  loading: boolean;
};

type ArcKind = "reference" | "payload";

type ArcGroup = {
  sourcePrim: string;
  arcs: Array<CompositionArc & { kind: ArcKind }>;
};

function groupBySourcePrim(
  references: readonly CompositionArc[],
  payloads: readonly CompositionArc[],
): ArcGroup[] {
  const groups = new Map<string, ArcGroup>();
  const push = (arc: CompositionArc, kind: ArcKind) => {
    let group = groups.get(arc.sourcePrim);
    if (!group) {
      group = { sourcePrim: arc.sourcePrim, arcs: [] };
      groups.set(arc.sourcePrim, group);
    }
    group.arcs.push({ ...arc, kind });
  };
  references.forEach((a) => push(a, "reference"));
  payloads.forEach((a) => push(a, "payload"));
  return [...groups.values()].sort((a, b) =>
    a.sourcePrim.localeCompare(b.sourcePrim),
  );
}

export function CompositionArcsCard({
  inspection,
  loading,
}: CompositionArcsCardProps) {
  const referenceCount = inspection?.references.length ?? 0;
  const payloadCount = inspection?.payloads.length ?? 0;
  const missingCount = useMemo(() => {
    if (!inspection) return 0;
    let n = 0;
    for (const a of inspection.references) if (a.state === "missing") n += 1;
    for (const a of inspection.payloads) if (a.state === "missing") n += 1;
    return n;
  }, [inspection]);
  // Phase 4: surface the deferred-payload total separately from
  // missing arcs so the card distinguishes "couldn't load" (error)
  // from "chose not to load" (informational).
  const unloadedCount = useMemo(() => {
    if (!inspection) return 0;
    let n = 0;
    for (const a of inspection.payloads) if (a.state === "unloaded") n += 1;
    return n;
  }, [inspection]);

  const groups = useMemo(() => {
    if (!inspection) return [];
    return groupBySourcePrim(inspection.references, inspection.payloads);
  }, [inspection]);

  return (
    <article className="card">
      <p className="card-title">Composition Arcs</p>
      {loading ? (
        <p className="card-empty">Inspecting stage…</p>
      ) : !inspection ? (
        <p className="card-empty">Open a USD asset to view composition arcs.</p>
      ) : referenceCount === 0 && payloadCount === 0 ? (
        <p className="card-empty">No composition arcs.</p>
      ) : (
        <>
          <dl className="card-grid">
            <dt>References</dt>
            <dd>{referenceCount}</dd>
            <dt>Payloads</dt>
            <dd>{payloadCount}</dd>
            {unloadedCount > 0 && (
              <>
                <dt>Deferred</dt>
                <dd className="muted">{unloadedCount}</dd>
              </>
            )}
            {missingCount > 0 && (
              <>
                <dt>Missing</dt>
                <dd className="card-error">{missingCount}</dd>
              </>
            )}
          </dl>
          <ul className="card-list">
            {groups.map((group) => (
              <li key={group.sourcePrim}>
                <details>
                  <summary className="card-path">
                    {group.sourcePrim}{" "}
                    <span className="muted">({group.arcs.length})</span>
                  </summary>
                  <ul className="card-list">
                    {group.arcs.map((arc, i) => (
                      <li
                        key={`${arc.kind}:${arc.assetPath}:${arc.targetPrim}:${i}`}
                        className={
                          arc.state === "missing"
                            ? "issue issue-error"
                            : "issue"
                        }
                      >
                        <strong>{arc.kind}</strong> → {arc.assetPath}
                        {arc.targetPrim && <> @ {arc.targetPrim}</>}{" "}
                        <span
                          className={
                            arc.state === "missing"
                              ? "badge badge-error"
                              : arc.state === "unloaded"
                                ? "badge badge-muted"
                                : "badge badge-ok"
                          }
                        >
                          {arc.state}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
