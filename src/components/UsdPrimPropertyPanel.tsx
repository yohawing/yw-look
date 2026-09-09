import { useCallback, useState } from "react";
import { useAsyncFetch } from "../hooks/useAsyncFetch";
import {
  inspectAttributeTimeSamples,
  inspectPrim,
  type AttributeInfo,
  type MetadataEntry,
  type PrimInspection,
  type RelationshipInfo,
  type TimeSampleEntry,
} from "../lib/usd";
import {
  SidebarEmpty,
  SidebarError,
  SidebarSection,
} from "../lib/sidebarPrimitives";
import { Badge, BadgeButton } from "./ui/Badge";
import { useViewerStore } from "../stores/viewerStore";

type UsdPrimPropertyPanelProps = {
  /** Absolute path to the USD file. `null` while no USD file is open. */
  path: string | null;
  /** Render inside the Selected inspector instead of as a top-level card. */
  embedded?: boolean;
};

const MAX_SAMPLES = 100;

/** Inline SVG line chart for numeric time samples. viewBox is 200×50. */
function TimeSampleLineChart({ samples }: { samples: TimeSampleEntry[] }) {
  const numeric = samples
    .map((s) => ({ time: s.time, value: parseFloat(s.valueSummary) }))
    .filter((p) => isFinite(p.value));

  if (numeric.length < 2) return null;

  const times = numeric.map((p) => p.time);
  const values = numeric.map((p) => p.value);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const tRange = tMax - tMin || 1;
  const vRange = vMax - vMin || 1;

  const W = 200;
  const H = 50;
  const PAD_X = 2;
  const PAD_Y = 4;

  const toX = (t: number) => PAD_X + ((t - tMin) / tRange) * (W - PAD_X * 2);
  const toY = (v: number) =>
    H - PAD_Y - ((v - vMin) / vRange) * (H - PAD_Y * 2);

  const pointsStr = numeric
    .map((p) => `${toX(p.time).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="ts-chart"
      aria-hidden="true"
    >
      {/* axis lines */}
      <line
        x1={PAD_X}
        y1={H - PAD_Y}
        x2={W - PAD_X}
        y2={H - PAD_Y}
        className="ts-chart-axis"
      />
      <line
        x1={PAD_X}
        y1={PAD_Y}
        x2={PAD_X}
        y2={H - PAD_Y}
        className="ts-chart-axis"
      />
      {/* data polyline */}
      <polyline points={pointsStr} className="ts-chart-line" fill="none" />
      {/* data dots */}
      {numeric.map((p, i) => (
        <circle
          key={i}
          cx={toX(p.time).toFixed(1)}
          cy={toY(p.value).toFixed(1)}
          r="1.5"
          className="ts-chart-dot"
        />
      ))}
    </svg>
  );
}

/** Expandable panel showing time samples for a single attribute. */
function TimeSamplesPanel({
  path,
  primPath,
  attrName,
  onClose,
}: {
  path: string;
  primPath: string;
  attrName: string;
  onClose: () => void;
}) {
  const fetchTimeSamples = useCallback(
    () => inspectAttributeTimeSamples(path, primPath, attrName, MAX_SAMPLES),
    [attrName, path, primPath],
  );
  const { data, loading, error } = useAsyncFetch(
    fetchTimeSamples,
    [fetchTimeSamples],
    {
      errorFallback: "Failed to inspect attribute samples.",
      initialLoading: true,
    },
  );

  return (
    <div className="ts-panel">
      <div className="ts-panel-header">
        <span className="ts-panel-title">
          Time Samples: <code>{attrName}</code>
        </span>
        <button
          type="button"
          className="ts-panel-close"
          onClick={onClose}
          aria-label="Close time samples"
        >
          ×
        </button>
      </div>

      {loading && <p className="muted ts-panel-msg">Loading…</p>}
      {error && (
        <p className="muted ts-panel-msg">Time sample data not available.</p>
      )}

      {data && !loading && (
        <>
          {/* ---- mini line chart (numeric types only) ---- */}
          {data.numericMin !== null && data.samples.length >= 2 && (
            <div className="ts-chart-wrap">
              <TimeSampleLineChart samples={data.samples} />
            </div>
          )}

          {/* ---- numeric statistics ---- */}
          {data.numericMin !== null && (
            <p className="ts-stats muted">
              min&nbsp;{data.numericMin.toPrecision(5)}&ensp; max&nbsp;
              {data.numericMax!.toPrecision(5)}&ensp; mean&nbsp;
              {data.numericMean!.toPrecision(5)}
            </p>
          )}

          {/* ---- truncation notice ---- */}
          {data.totalCount > data.samples.length && (
            <p className="ts-trunc-notice muted">
              Showing first {data.samples.length} of {data.totalCount} samples
            </p>
          )}

          {/* ---- sample table ---- */}
          <div className="ts-table-wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th className="ts-col-time">Time</th>
                  <th className="ts-col-value">Value</th>
                </tr>
              </thead>
              <tbody>
                {data.samples.map((s, i) => (
                  <tr key={i} className="ts-table-row">
                    <td className="ts-col-time">{s.time}</td>
                    <td className="ts-col-value">
                      {s.valueSummary || <span className="muted">(none)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AttributeRow({
  attr,
  onViewSamples,
}: {
  attr: AttributeInfo;
  onViewSamples: (attrName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = attr.valueSummary.length > 40;
  return (
    <tr className="prop-table-row">
      <td className="prop-table-name">{attr.name}</td>
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
          <Badge mono size="sm">
            C
          </Badge>
        ) : null}
      </td>
      <td className="prop-table-samples">
        {attr.timeSampleCount > 0 ? (
          <BadgeButton
            className="prop-samples-badge"
            mono
            size="sm"
            onClick={() => onViewSamples(attr.name)}
          >
            {attr.timeSampleCount}s
          </BadgeButton>
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
  embedded = false,
}: UsdPrimPropertyPanelProps) {
  const selectedPrimPath = useViewerStore((state) => state.selectedUsdPrimPath);
  /** Attribute name whose samples are currently shown. `null` = none. */
  const [activeSampleAttr, setActiveSampleAttr] = useState<string | null>(null);
  const canInspectPrim = path !== null && selectedPrimPath !== null;
  const fetchPrimInspection = useCallback(() => {
    if (!path || !selectedPrimPath) {
      throw new Error("Prim inspection requires an active USD selection.");
    }
    return inspectPrim(path, selectedPrimPath);
  }, [path, selectedPrimPath]);
  const {
    data: inspection,
    loading,
    error,
  } = useAsyncFetch<PrimInspection>(
    canInspectPrim ? fetchPrimInspection : null,
    [canInspectPrim, fetchPrimInspection],
    {
      enabled: canInspectPrim,
      errorFallback: "Failed to inspect prim.",
      onBeforeFetch: () => setActiveSampleAttr(null),
      onReset: () => setActiveSampleAttr(null),
    },
  );

  if (!path || !selectedPrimPath) return null;

  const panel = (
    <div className="prim-property-panel">
      {!embedded && <p className="prop-prim-path">{selectedPrimPath}</p>}

      {loading && <SidebarEmpty>Loading…</SidebarEmpty>}
      {error && (
        <SidebarError>{`Prim inspection failed: ${error}`}</SidebarError>
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
                      <AttributeRow
                        key={attr.name}
                        attr={attr}
                        onViewSamples={(name) =>
                          setActiveSampleAttr((prev) =>
                            prev === name ? null : name,
                          )
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <SidebarEmpty>No attributes authored.</SidebarEmpty>
          )}

          {/* ---- inline time-samples panel (shown below the table) ---- */}
          {activeSampleAttr && (
            <TimeSamplesPanel
              path={path}
              primPath={selectedPrimPath}
              attrName={activeSampleAttr}
              onClose={() => setActiveSampleAttr(null)}
            />
          )}

          <RelationshipSection relationships={inspection.relationships} />
          <MetadataSection entries={inspection.metadata} />
        </>
      )}
    </div>
  );

  if (embedded) {
    return (
      <section
        className="selected-inspector-section usd-properties-static"
        data-testid="usd-prim-panel"
      >
        <div className="selected-inspector-section-head">
          <span>USD Properties</span>
          {inspection ? (
            <span className="usd-properties-static-count">
              {inspection.attributes.length}
            </span>
          ) : null}
        </div>
        {panel}
      </section>
    );
  }

  return (
    <SidebarSection
      title="Advanced: Prim Properties"
      count={inspection?.attributes.length}
      collapsible
      defaultOpen={false}
    >
      {panel}
    </SidebarSection>
  );
}
