import { useSyncExternalStore } from "react";
import type { PackMetadata } from "../../types/format-pack";
import {
  SelectField,
  Disclosure,
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
} from "../../lib/sidebarPrimitives";
import "./inspection.css";

export function IfcMetadataCard({
  metadata,
  view = "display",
  selectedKey,
}: {
  metadata: PackMetadata;
  view?: "display" | "selection";
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  if (metadata.kind !== "ifc") return null;
  return (
    <IfcInspector
      inspection={metadata.inspection}
      view={view}
      selectedKey={selectedKey}
    />
  );
}

function IfcInspector({
  inspection,
  view = "display",
  selectedKey,
}: {
  inspection: Extract<PackMetadata, { kind: "ifc" }>["inspection"];
  view?: "display" | "selection";
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const state = useSyncExternalStore(
    inspection.subscribe,
    inspection.getSnapshot,
  );
  if (view === "display")
    return (
      <div className="ifc-inspector">
        <SidebarSection title="IFC Display">
          <SelectField
            label="Color by"
            size="sm"
            aria-label="IFC color mode"
            value={state.colorMode}
            onChange={(event) => {
              void inspection.setColorMode(
                event.target.value as typeof state.colorMode,
              );
            }}
          >
            <option value="original">Original</option>
            <option value="category">Category</option>
            <option value="element">Element</option>
          </SelectField>
        </SidebarSection>
      </div>
    );
  if (!state.selected || `ifc:${state.selected.id}` !== selectedKey)
    return null;
  return (
    <div className="ifc-inspector">
      <SidebarKeyValueRows
        rows={[{ id: "storey", label: "Storey", value: state.selected.storey }]}
      />
      {state.loading && (
        <SidebarEmpty>Loading element information…</SidebarEmpty>
      )}
      {state.error && <SidebarError>{state.error}</SidebarError>}
      {state.limited && (
        <SidebarEmpty>
          Some information was omitted because the detail limit was reached.
        </SidebarEmpty>
      )}
      {[
        "Identity",
        "Type",
        "Materials",
        "Element properties",
        "Type properties",
        "Quantities",
      ].map((group) => {
        const sections = state.sections.filter(
          (section) => section.group === group,
        );
        if (!sections.length) return null;
        return (
          <SidebarSection
            key={group}
            title={group}
            count={group === "Identity" ? undefined : sections.length}
            collapsible
            defaultOpen={group !== "Identity"}
          >
            {sections.map((section, index) => {
              const rows = (
                <SidebarKeyValueRows
                  rows={section.rows.map((row, i) => ({
                    id: String(i),
                    label: row.name,
                    value: (
                      <span className="ifc-detail-value">{row.value}</span>
                    ),
                  }))}
                />
              );
              return group === "Identity" ? (
                <div key={index}>{rows}</div>
              ) : (
                <Disclosure
                  key={`${state.selected?.id}:${index}`}
                  title={section.name}
                  variant="inline"
                  defaultOpen={false}
                  className="ifc-detail-section"
                >
                  {section.rows.length ? (
                    rows
                  ) : (
                    <SidebarEmpty>No values provided.</SidebarEmpty>
                  )}
                </Disclosure>
              );
            })}
          </SidebarSection>
        );
      })}
    </div>
  );
}
