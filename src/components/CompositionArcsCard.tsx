import { useMemo } from "react";
import type {
  CompositionArc,
  CompositionArcKind,
  StageInspection,
} from "../lib/usd";

type CompositionArcsCardProps = {
  inspection: StageInspection | null;
  loading: boolean;
};

type ArcGroup = {
  sourcePrim: string;
  arcs: CompositionArc[];
};

function groupBySourcePrim(arcs: readonly CompositionArc[]): ArcGroup[] {
  const groups = new Map<string, ArcGroup>();
  for (const arc of arcs) {
    let group = groups.get(arc.sourcePrim);
    if (!group) {
      group = { sourcePrim: arc.sourcePrim, arcs: [] };
      groups.set(arc.sourcePrim, group);
    }
    group.arcs.push(arc);
  }
  return [...groups.values()].sort((a, b) =>
    a.sourcePrim.localeCompare(b.sourcePrim),
  );
}

/** Human-readable label for each arc kind. */
function kindLabel(kind: CompositionArcKind | undefined): string {
  switch (kind) {
    case "reference":
      return "reference";
    case "payload":
      return "payload";
    case "inherits":
      return "inherits";
    case "specializes":
      return "specializes";
    case "variantSelection":
      return "variantSet";
    case "over":
      return "over";
    default:
      return "reference";
  }
}

type ArcSectionProps = {
  title: string;
  arcs: readonly CompositionArc[];
};

/**
 * Renders one collapsible section for a set of composition arcs of the
 * same kind, grouped by source prim.
 */
function ArcSection({ title, arcs }: ArcSectionProps) {
  if (arcs.length === 0) return null;
  const groups = groupBySourcePrim(arcs);
  return (
    <section>
      <p className="card-subtitle">{title}</p>
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
                    key={`${arc.kind ?? ""}:${arc.assetPath}:${arc.targetPrim}:${i}`}
                    className={
                      arc.state === "missing" ? "issue issue-error" : "issue"
                    }
                  >
                    <strong>{kindLabel(arc.kind)}</strong>
                    {arc.kind === "variantSelection" ? (
                      <>
                        {" "}
                        <span className="badge badge-ok">{arc.targetPrim}</span>
                      </>
                    ) : arc.kind === "inherits" ||
                      arc.kind === "specializes" ? (
                      <>
                        {" "}
                        → <span className="card-path">{arc.targetPrim}</span>
                      </>
                    ) : (
                      <>
                        {" "}
                        → {arc.assetPath}
                        {arc.targetPrim && <> @ {arc.targetPrim}</>}
                      </>
                    )}{" "}
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
    </section>
  );
}

export function CompositionArcsCard({
  inspection,
  loading,
}: CompositionArcsCardProps) {
  const referenceCount = inspection?.references.length ?? 0;
  const payloadCount = inspection?.payloads.length ?? 0;
  const inheritsCount = inspection?.inherits?.length ?? 0;
  const specializesCount = inspection?.specializes?.length ?? 0;
  const variantSelectionCount = inspection?.variantSelectionArcs?.length ?? 0;

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

  const totalCount =
    referenceCount +
    payloadCount +
    inheritsCount +
    specializesCount +
    variantSelectionCount;

  return (
    <article className="card">
      <p className="card-title">Composition Arcs</p>
      {loading ? (
        <p className="card-empty">Inspecting stage…</p>
      ) : !inspection ? (
        <p className="card-empty">Open a USD asset to view composition arcs.</p>
      ) : totalCount === 0 ? (
        <p className="card-empty">No composition arcs.</p>
      ) : (
        <>
          <dl className="card-grid">
            {referenceCount > 0 && (
              <>
                <dt>References</dt>
                <dd>{referenceCount}</dd>
              </>
            )}
            {payloadCount > 0 && (
              <>
                <dt>Payloads</dt>
                <dd>{payloadCount}</dd>
              </>
            )}
            {inheritsCount > 0 && (
              <>
                <dt>Inherits</dt>
                <dd>{inheritsCount}</dd>
              </>
            )}
            {specializesCount > 0 && (
              <>
                <dt>Specializes</dt>
                <dd>{specializesCount}</dd>
              </>
            )}
            {variantSelectionCount > 0 && (
              <>
                <dt>Variant Selections</dt>
                <dd>{variantSelectionCount}</dd>
              </>
            )}
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
          <ArcSection title="References" arcs={inspection.references} />
          <ArcSection title="Payloads" arcs={inspection.payloads} />
          {inspection.inherits && (
            <ArcSection title="Inherits" arcs={inspection.inherits} />
          )}
          {inspection.specializes && (
            <ArcSection title="Specializes" arcs={inspection.specializes} />
          )}
          {inspection.variantSelectionArcs && (
            <ArcSection
              title="Variant Selections"
              arcs={inspection.variantSelectionArcs}
            />
          )}
        </>
      )}
    </article>
  );
}
