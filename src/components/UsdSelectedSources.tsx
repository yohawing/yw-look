import { t, useLocale } from "../lib/i18n";
import type { CompositionArc, StageInspection } from "../lib/usd";
import { Badge } from "./ui/Badge";
import { KeyValueRows } from "./ui/KeyValueRows";

type UsdSelectedSourcesProps = {
  inspection: StageInspection | null;
  primPath: string | null;
  /** Current session state overrides the initial stage inspection. */
  payloadLoaded?: boolean;
};

export function UsdSelectedSources({
  inspection,
  primPath,
  payloadLoaded,
}: UsdSelectedSourcesProps) {
  useLocale();
  if (!inspection || !primPath) return null;
  const sections = [
    { title: t("references"), arcs: inspection.references },
    { title: t("payloads"), arcs: inspection.payloads },
  ];
  return sections.map(({ title, arcs }) => {
    const selected = arcs.filter((arc) => arc.sourcePrim === primPath);
    if (!selected.length) return null;
    return (
      <div className="selected-mmd-section" key={title}>
        <div className="selected-mmd-head">{title}</div>
        {selected.map((arc, index) => {
          const state: CompositionArc["state"] =
            title === "Payloads" &&
            payloadLoaded !== undefined &&
            arc.state !== "missing"
              ? payloadLoaded
                ? "loaded"
                : "unloaded"
              : arc.state;
          return (
            <KeyValueRows
              key={`${arc.assetPath}:${arc.targetPrim}:${index}`}
              density="regular"
              rows={[
                {
                  id: "asset",
                  label: t("asset"),
                  value: arc.assetPath || "This layer",
                  mono: true,
                },
                {
                  id: "target",
                  label: t("target_prim"),
                  value: arc.targetPrim || "Default prim",
                  mono: true,
                },
                {
                  id: "state",
                  label: t("state"),
                  value: (
                    <Badge
                      size="sm"
                      variant={
                        state === "missing"
                          ? "error"
                          : state === "unloaded"
                            ? "neutral"
                            : "success"
                      }
                    >
                      {state}
                    </Badge>
                  ),
                },
              ]}
            />
          );
        })}
      </div>
    );
  });
}
