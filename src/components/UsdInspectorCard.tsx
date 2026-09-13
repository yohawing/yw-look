import { t, useLocale, formatNumber } from "../lib/i18n";
import type { CSSProperties } from "react";
import type {
  AssetIssue,
  LayerInfo,
  StageInspection,
  StageLoadPolicy,
  StageSummary,
  VariantSelection,
} from "../lib/usd";
import type {
  StageCapabilityInfo,
  StageCapabilityKind,
  StageCapabilitySupport,
} from "../types/ipc";
import { Badge, Disclosure, SegmentedControl, SelectField } from "./ui";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "../lib/sidebarPrimitives";

const loadPolicyOptions = [
  { value: "loadAll", label: "Loaded" },
  { value: "noPayloads", label: "Deferred" },
] as const;

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
  useLocale();
  const hasOffset = layer.timeOffset !== 0 || layer.timeScale !== 1;
  return (
    <li
      className="yl-list-row yl-list-row--indented"
      style={{ "--layer-depth": layer.depth } as CSSProperties}
    >
      <div className="yl-list-row__main">
        <span className="yl-list-row__label">
          {layer.depth === 0 ? t("root") : t("sublayer")}
        </span>
        {layer.muted && (
          <Badge
            className="usd-inspector-badge"
            variant="error"
            size="sm"
            uppercase
          >
            {t("muted")}
          </Badge>
        )}
        {hasOffset && (
          <span className="usd-inspector-note">
            {layer.timeOffset !== 0 && `offset:${layer.timeOffset}`}
            {layer.timeOffset !== 0 && layer.timeScale !== 1 && " "}
            {layer.timeScale !== 1 && `scale:${layer.timeScale}`}
          </span>
        )}
      </div>
      <div className="yl-list-row__path">
        {shortLayerLabel(layer.identifier)}
      </div>
      {layer.comment && (
        <Disclosure variant="minimal" title={t("comment")} defaultOpen={false}>
          <p className="usd-layer-comment-text">{layer.comment}</p>
        </Disclosure>
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

const capabilityLabels: Record<StageCapabilityKind, string> = {
  pointInstancer: "Point Instancer",
  materialX: "MaterialX",
  skel: "UsdSkel",
  animationRange: "Animation Range",
  payload: "Payload",
  variantOverride: "Variant Override",
  usdAuthoredSplat: "USD-authored Splat",
};

const capabilityBadgeVariants: Record<
  StageCapabilitySupport,
  "success" | "warning" | "error"
> = {
  supported: "success",
  degraded: "warning",
  unsupported: "error",
};

function StageCapabilities({
  capabilities,
}: {
  capabilities: readonly StageCapabilityInfo[];
}) {
  useLocale();
  const detectedCapabilities = capabilities.filter(
    (capability) => capability.detected,
  );

  if (detectedCapabilities.length === 0) {
    return null;
  }

  return (
    <SidebarSection
      title={t("capabilities")}
      count={detectedCapabilities.length}
      collapsible
      defaultOpen={false}
    >
      <ul className="yl-status-list">
        {detectedCapabilities.map((capability) => {
          const statusClass =
            capability.support === "degraded"
              ? "yl-status-row--warning"
              : capability.support === "unsupported"
                ? "yl-status-row--error"
                : null;
          const reasonVisible =
            capability.support !== "supported" && capability.reason;

          return (
            <li
              key={capability.kind}
              className={["yl-status-row", statusClass]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="yl-list-row__main">
                <strong>{capabilityLabels[capability.kind]}</strong>
                <Badge
                  className="usd-inspector-badge"
                  variant={capabilityBadgeVariants[capability.support]}
                  size="sm"
                >
                  {capability.support}
                </Badge>
              </div>
              {reasonVisible && (
                <div className="usd-inspector-note">{capability.reason}</div>
              )}
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
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
   * Only wired when the backend can enumerate variants.
   */
  onVariantChange?: (
    primPath: string,
    setName: string,
    variantName: string,
  ) => void;
  /** #31: current variant selections mirrored from App state. Used to
   * keep the pulldowns in sync after a re-mount (e.g. file re-open). */
  variantSelections?: VariantSelection[];
  /** Backend failure from applying the current variant selection. */
  variantSelectionError?: string | null;
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
  variantSelectionError,
}: UsdInspectorCardProps) {
  useLocale();
  const showControl = loadPolicy !== null;
  const effectiveCapabilities =
    summary?.capabilities ?? inspection?.capabilities ?? [];
  const variantOverrideSupported = effectiveCapabilities.some(
    (capability) =>
      capability.kind === "variantOverride" &&
      capability.detected &&
      capability.support === "supported",
  );
  return (
    <SidebarSection title={t("usd_details")} collapsible defaultOpen={false}>
      {showControl && (
        <SegmentedControl
          aria-label={t("usd_load_policy")}
          onValueChange={onLoadPolicyChange}
          options={loadPolicyOptions}
          size="sm"
          value={loadPolicy}
        />
      )}
      {error ? (
        <SidebarError>{error}</SidebarError>
      ) : loading ? (
        <SidebarEmpty>{t("inspecting_stage")}</SidebarEmpty>
      ) : !summary && !inspection ? (
        <SidebarEmpty>
          {t("open_a_usd_usda_usdc_usdz_asset_to_inspect_its_stage")}
        </SidebarEmpty>
      ) : (
        summary && (
          <SidebarKeyValueRows
            rows={asRows([
              {
                id: "layers",
                label: t("layers"),
                value: summary.layerCount,
                mono: true,
              },
              {
                id: "root-prims",
                label: t("root_prims"),
                value: summary.rootPrimCount,
                mono: true,
              },
              {
                id: "meshes",
                label: t("meshes"),
                value: summary.meshCount,
                mono: true,
              },
              {
                id: "vertices",
                label: t("vertices"),
                value: formatNumber(summary.totalVertices),
                mono: true,
              },
              {
                id: "triangles",
                label: t("triangles"),
                value: formatNumber(summary.totalTriangles),
                mono: true,
              },
              {
                id: "payloads",
                label: t("payloads"),
                value:
                  summary.unloadedPayloadCount > 0
                    ? `${summary.payloadCount} (${summary.unloadedPayloadCount} deferred)`
                    : summary.payloadCount,
                mono: true,
                tone: summary.unloadedPayloadCount > 0 ? "warn" : "default",
              },
              {
                id: "variants",
                label: t("variants"),
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
                label: t("duration"),
                value: `${summary.durationSeconds.toFixed(2)}s`,
                mono: true,
              },
              (summary.resolvedReferenceCount > 0 ||
                summary.unresolvedReferenceCount > 0) && {
                id: "references",
                label: t("references"),
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
                label: t("payloads_resolved"),
                value: `${summary.resolvedPayloadCount} resolved${
                  summary.unresolvedPayloadCount > 0
                    ? ` / ${summary.unresolvedPayloadCount} unresolved`
                    : ""
                }`,
                tone: summary.unresolvedPayloadCount > 0 ? "danger" : "default",
              },
            ])}
          />
        )
      )}
      {!error && !loading && (summary || inspection) ? (
        <>
          <StageCapabilities capabilities={effectiveCapabilities} />
          {summary && summary.primTypeCounts.length > 0 && (
            <SidebarSection
              title={t("prim_types")}
              count={summary.primTypeCounts.length}
              collapsible
              defaultOpen={false}
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
              <SidebarSection
                title={t("advanced_stage_metadata")}
                collapsible
                defaultOpen={false}
              >
                <SidebarKeyValueRows
                  rows={[
                    {
                      id: "defaultPrim",
                      label: t("defaultprim"),
                      value: inspection.defaultPrim ?? "(unset)",
                      tone: inspection.defaultPrim ? "default" : "muted",
                    },
                    {
                      id: "upAxis",
                      label: t("upaxis"),
                      value: inspection.upAxis ?? "(default)",
                      tone: inspection.upAxis ? "default" : "muted",
                    },
                    {
                      id: "metersPerUnit",
                      label: t("metersperunit"),
                      value:
                        inspection.metersPerUnit !== null
                          ? inspection.metersPerUnit
                          : "(default)",
                      mono: true,
                    },
                    {
                      id: "timeCodesPerSecond",
                      label: t("timecodespersecond"),
                      value: formatAuthoredNumber(
                        inspection.timeCodesPerSecond,
                      ),
                      mono: true,
                    },
                    {
                      id: "framesPerSecond",
                      label: t("framespersecond"),
                      value: formatAuthoredNumber(inspection.framesPerSecond),
                      mono: true,
                    },
                    {
                      id: "startTimeCode",
                      label: t("starttimecode"),
                      value: formatAuthoredNumber(inspection.startTimeCode),
                      mono: true,
                    },
                    {
                      id: "endTimeCode",
                      label: t("endtimecode"),
                      value: formatAuthoredNumber(inspection.endTimeCode),
                      mono: true,
                    },
                    {
                      id: "rootLayer",
                      label: t("rootlayer"),
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
                    <span className="muted">{t("comment_2")}</span>
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
                  title={t("advanced_layer_stack")}
                  count={inspection.layers!.length}
                  collapsible
                  defaultOpen={false}
                >
                  <ul className="yl-list">
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
                  title={t("advanced_layer_stack")}
                  count={inspection.composedLayers.length + 1}
                  collapsible
                  defaultOpen={false}
                >
                  <ul className="yl-list">
                    <li className="yl-list-row yl-list-row--indented">
                      <div className="yl-list-row__main">
                        <span className="yl-list-row__label">{t("root")}</span>
                      </div>
                      <div className="yl-list-row__path">
                        {shortLayerLabel(inspection.path)}
                      </div>
                    </li>
                    {inspection.composedLayers.map((layer, i) => (
                      <li
                        key={`${layer}:${i}`}
                        className="yl-list-row yl-list-row--indented"
                        style={{ "--layer-depth": 1 } as CSSProperties}
                      >
                        <div className="yl-list-row__main">
                          <span className="yl-list-row__label">↳</span>
                        </div>
                        <div className="yl-list-row__path">
                          {shortLayerLabel(layer)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </SidebarSection>
              ) : null}
              {inspection.variantSets.length > 0 && (
                <SidebarSection
                  title={t("variant_sets")}
                  count={inspection.variantSets.length}
                  collapsible
                  defaultOpen={false}
                >
                  {variantSelectionError && (
                    <SidebarError>{variantSelectionError}</SidebarError>
                  )}
                  <ul className="yl-list">
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
                        typeof onVariantChange === "function" &&
                        variantOverrideSupported;
                      return (
                        <li
                          key={`${vs.primPath}:${vs.setName}:${i}`}
                          className="yl-list-row"
                        >
                          <div className="yl-list-row__main">
                            <strong className="yl-list-row__label">
                              {vs.setName}
                            </strong>
                            {canSwitch ? (
                              <SelectField
                                className="usd-variant-select"
                                selectClassName="usd-variant-select__control"
                                value={activeSelection}
                                onChange={(e) =>
                                  onVariantChange(
                                    vs.primPath,
                                    vs.setName,
                                    e.target.value,
                                  )
                                }
                              >
                                {vs.variants.map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                              </SelectField>
                            ) : (
                              activeSelection && (
                                <Badge
                                  className="usd-inspector-badge"
                                  variant="success"
                                  size="sm"
                                >
                                  {activeSelection}
                                </Badge>
                              )
                            )}
                          </div>
                          <div className="yl-list-row__path">
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
                  title={t("missing_assets")}
                  count={inspection.missingAssets.length}
                  collapsible
                  defaultOpen={false}
                >
                  <SidebarError>
                    {t("missing_assets_2")}
                    {inspection.missingAssets.length}
                  </SidebarError>
                </SidebarSection>
              )}
            </>
          )}
          {issues.length > 0 && (
            <SidebarSection
              title={t("issues")}
              count={issues.length}
              collapsible
              defaultOpen={false}
            >
              <ul className="yl-status-list">
                {issues.map((issue) => (
                  <li
                    key={`${issue.code}:${issue.contextPath ?? ""}:${issue.message}`}
                    className={`yl-status-row yl-status-row--${issue.level}`}
                  >
                    <strong>{issue.code}</strong>: {issue.message}
                  </li>
                ))}
              </ul>
            </SidebarSection>
          )}
        </>
      ) : null}
    </SidebarSection>
  );
}
