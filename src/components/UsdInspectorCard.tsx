import type { CSSProperties } from "react";
import type {
  AssetIssue,
  LayerInfo,
  StageInspection,
  StageLoadPolicy,
  StageSummary,
  VariantSelection,
} from "../lib/usd";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

/** Pretty-print a numeric metadatum, falling back to "(default)" when
 * the stage didn't author the field. The fallback wording is shared
 * across timeCodesPerSecond / framesPerSecond / start/endTimeCode so
 * the metadata table reads consistently. */
function formatAuthoredNumber(value: number | null): string {
  return value === null ? "(default)" : String(value);
}

/** Render one row in the layer stack list. Handles depth indentation,
 * muted badge, offset display, and an expandable comment block. */
function LayerRow({ layer }: { layer: LayerInfo }) {
  const hasOffset = layer.timeOffset !== 0 || layer.timeScale !== 1;
  return (
    <li
      className="usd-layer-row"
      title={layer.identifier}
      style={{ "--layer-depth": layer.depth } as CSSProperties}
    >
      <div className="usd-layer-main">
        <span className="usd-layer-prefix">
          {layer.depth === 0 ? "root" : "↳ sublayer"}
        </span>
        {layer.muted && (
          <span
            className="badge badge-error usd-inspector-chip"
            title="This layer is muted and does not contribute to the composed stage"
          >
            muted
          </span>
        )}
        {hasOffset && (
          <span className="usd-inspector-note">
            {layer.timeOffset !== 0 && `offset:${layer.timeOffset}`}
            {layer.timeOffset !== 0 && layer.timeScale !== 1 && " "}
            {layer.timeScale !== 1 && `scale:${layer.timeScale}`}
          </span>
        )}
      </div>
      <div className="usd-inspector-path">
        {shortLayerLabel(layer.identifier)}
      </div>
      {layer.comment && (
        <details className="usd-layer-comment">
          <summary>comment</summary>
          <p>{layer.comment}</p>
        </details>
      )}
    </li>
  );
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

function asRows(
  entries: Array<SidebarKeyValueRow | false | null | undefined>,
): SidebarKeyValueRow[] {
  return entries.filter(Boolean) as SidebarKeyValueRow[];
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
    <>
      <SidebarSection title="USD Inspector">
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
        {error ? (
          <SidebarError>{error}</SidebarError>
        ) : loading ? (
          <SidebarEmpty>Inspecting stage…</SidebarEmpty>
        ) : !summary && !inspection ? (
          <SidebarEmpty>
            Open a USD/USDA/USDC/USDZ asset to inspect its stage.
          </SidebarEmpty>
        ) : (
          summary && (
            <SidebarKeyValueRows
              rows={asRows([
                {
                  id: "layers",
                  label: "Layers",
                  value: summary.layerCount,
                  mono: true,
                },
                {
                  id: "root-prims",
                  label: "Root prims",
                  value: summary.rootPrimCount,
                  mono: true,
                },
                {
                  id: "meshes",
                  label: "Meshes",
                  value: summary.meshCount,
                  mono: true,
                },
                {
                  id: "vertices",
                  label: "Vertices",
                  value: summary.totalVertices.toLocaleString(),
                  mono: true,
                },
                {
                  id: "triangles",
                  label: "Triangles",
                  value: summary.totalTriangles.toLocaleString(),
                  mono: true,
                },
                {
                  id: "payloads",
                  label: "Payloads",
                  value:
                    summary.unloadedPayloadCount > 0
                      ? `${summary.payloadCount} (${summary.unloadedPayloadCount} deferred)`
                      : summary.payloadCount,
                  mono: true,
                  tone: summary.unloadedPayloadCount > 0 ? "warn" : "default",
                },
                {
                  id: "variants",
                  label: "Variants",
                  value:
                    summary.variantSetCount > 0
                      ? `${summary.hasVariants ? "yes" : "no"} (${summary.variantSetCount} sets)`
                      : summary.hasVariants
                        ? "yes"
                        : "no",
                  tone: summary.hasVariants ? "default" : "muted",
                },
                summary.durationSeconds !== null && {
                  id: "duration",
                  label: "Duration",
                  value: `${summary.durationSeconds.toFixed(2)}s`,
                  mono: true,
                },
                (summary.resolvedReferenceCount > 0 ||
                  summary.unresolvedReferenceCount > 0) && {
                  id: "references",
                  label: "References",
                  value: `${summary.resolvedReferenceCount} resolved${
                    summary.unresolvedReferenceCount > 0
                      ? ` / ${summary.unresolvedReferenceCount} unresolved`
                      : ""
                  }`,
                  tone:
                    summary.unresolvedReferenceCount > 0 ? "danger" : "default",
                },
                (summary.resolvedPayloadCount > 0 ||
                  summary.unresolvedPayloadCount > 0) && {
                  id: "resolved-payloads",
                  label: "Payloads resolved",
                  value: `${summary.resolvedPayloadCount} resolved${
                    summary.unresolvedPayloadCount > 0
                      ? ` / ${summary.unresolvedPayloadCount} unresolved`
                      : ""
                  }`,
                  tone:
                    summary.unresolvedPayloadCount > 0 ? "danger" : "default",
                },
              ])}
            />
          )
        )}
      </SidebarSection>
      {!error && !loading && (summary || inspection) ? (
        <>
          {summary && summary.primTypeCounts.length > 0 && (
            <SidebarSection
              title="Prim Types"
              count={summary.primTypeCounts.length}
            >
              <SidebarKeyValueRows
                rows={summary.primTypeCounts.map((entry) => ({
                  id: entry.typeName,
                  label: entry.typeName,
                  value: entry.count,
                  mono: true,
                }))}
              />
            </SidebarSection>
          )}
          {inspection && (
            <>
              <SidebarSection title="Metadata">
                <SidebarKeyValueRows
                  rows={[
                    {
                      id: "defaultPrim",
                      label: "defaultPrim",
                      value: inspection.defaultPrim ?? "(unset)",
                      tone: inspection.defaultPrim ? "default" : "muted",
                    },
                    {
                      id: "upAxis",
                      label: "upAxis",
                      value: inspection.upAxis ?? "(default)",
                      tone: inspection.upAxis ? "default" : "muted",
                    },
                    {
                      id: "metersPerUnit",
                      label: "metersPerUnit",
                      value:
                        inspection.metersPerUnit !== null
                          ? inspection.metersPerUnit
                          : "(default)",
                      mono: true,
                    },
                    {
                      id: "timeCodesPerSecond",
                      label: "timeCodesPerSecond",
                      value: formatAuthoredNumber(
                        inspection.timeCodesPerSecond,
                      ),
                      mono: true,
                    },
                    {
                      id: "framesPerSecond",
                      label: "framesPerSecond",
                      value: formatAuthoredNumber(inspection.framesPerSecond),
                      mono: true,
                    },
                    {
                      id: "startTimeCode",
                      label: "startTimeCode",
                      value: formatAuthoredNumber(inspection.startTimeCode),
                      mono: true,
                    },
                    {
                      id: "endTimeCode",
                      label: "endTimeCode",
                      value: formatAuthoredNumber(inspection.endTimeCode),
                      mono: true,
                    },
                    {
                      id: "rootLayer",
                      label: "rootLayer",
                      value: rootLayerFormatLabel(
                        inspection.path,
                        inspection.rootLayerIsBinary,
                      ),
                    },
                  ]}
                />
                {inspection.comment && (
                  <p
                    className="sidebar-path"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    <span className="muted">comment: </span>
                    {inspection.comment}
                  </p>
                )}
              </SidebarSection>
              {/* #29 — Layer Stack: prefer rich `layers` data when available,
                  fall back to flat composedLayers for older/degraded backends. */}
              {(inspection.layers && inspection.layers.length > 0
                ? inspection.layers
                : null) !== null && inspection.layers!.length > 0 ? (
                <SidebarSection
                  title="Layer Stack"
                  count={inspection.layers!.length}
                >
                  <ul className="usd-layer-list">
                    {inspection.layers!.map((layer, i) => (
                      <LayerRow
                        key={`${layer.identifier}:${i}`}
                        layer={layer}
                      />
                    ))}
                  </ul>
                </SidebarSection>
              ) : inspection.composedLayers.length > 0 ? (
                <SidebarSection
                  title="Layer Stack"
                  count={inspection.composedLayers.length + 1}
                >
                  <ul className="usd-layer-list">
                    <li className="usd-layer-row" title={inspection.path}>
                      <div className="usd-layer-main">
                        <span className="usd-layer-prefix">root</span>
                      </div>
                      <div className="usd-inspector-path">
                        {shortLayerLabel(inspection.path)}
                      </div>
                    </li>
                    {inspection.composedLayers.map((layer, i) => (
                      <li
                        key={`${layer}:${i}`}
                        className="usd-layer-row"
                        title={layer}
                        style={{ "--layer-depth": 1 } as CSSProperties}
                      >
                        <div className="usd-layer-main">
                          <span className="usd-layer-prefix">↳</span>
                        </div>
                        <div className="usd-inspector-path">
                          {shortLayerLabel(layer)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </SidebarSection>
              ) : null}
              {inspection.variantSets.length > 0 && (
                <SidebarSection
                  title="Variant Sets"
                  count={inspection.variantSets.length}
                >
                  <ul className="usd-variant-list">
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
                          className="usd-variant-row"
                        >
                          <div className="usd-variant-main">
                            <strong>{vs.setName}</strong>
                            {canSwitch ? (
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
                            ) : (
                              activeSelection && (
                                <span className="badge badge-ok usd-inspector-chip">
                                  {activeSelection}
                                </span>
                              )
                            )}
                          </div>
                          <div className="usd-inspector-path">
                            <span aria-hidden="true">@ </span>
                            {vs.primPath}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </SidebarSection>
              )}
              {inspection.missingAssets.length > 0 && (
                <SidebarSection
                  title="Missing Assets"
                  count={inspection.missingAssets.length}
                >
                  <SidebarError>
                    Missing assets: {inspection.missingAssets.length}
                  </SidebarError>
                </SidebarSection>
              )}
            </>
          )}
          {issues.length > 0 && (
            <SidebarSection title="Issues" count={issues.length}>
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
            </SidebarSection>
          )}
        </>
      ) : null}
    </>
  );
}
