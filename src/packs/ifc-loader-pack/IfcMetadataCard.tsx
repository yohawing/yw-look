import { useState, useSyncExternalStore } from "react";
import type { PackMetadata } from "../../types/format-pack";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
} from "../../lib/sidebarPrimitives";
import { ifcSelectionKey } from "./inspection";
import "./inspection.css";

export function IfcMetadataCard({
  metadata,
  view = "properties",
  onSelect,
}: {
  metadata: PackMetadata;
  view?: "properties" | "hierarchy";
  onSelect?: (key: string | null) => void;
}) {
  if (metadata.kind !== "ifc") return null;
  return (
    <IfcInspector
      inspection={metadata.inspection}
      view={view}
      onSelect={onSelect}
    />
  );
}

function IfcInspector({
  inspection,
  view,
  onSelect,
}: {
  inspection: Extract<PackMetadata, { kind: "ifc" }>["inspection"];
  view: "properties" | "hierarchy";
  onSelect?: (key: string | null) => void;
}) {
  const state = useSyncExternalStore(
    inspection.subscribe,
    inspection.getSnapshot,
  );
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(150);
  const filtered = state.elements.filter((element) =>
    `${element.name} ${element.category} ${element.storey}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = new Map<string, typeof filtered>();
  for (const element of filtered.slice(0, limit)) {
    const group = `${element.building} / ${element.storey}`;
    const values = groups.get(group) ?? [];
    values.push(element);
    groups.set(group, values);
  }
  return (
    <div className="ifc-inspector">
      <SidebarSection title="IFC Display">
        <label className="ifc-color-mode">
          Color by{" "}
          <select
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
          </select>
        </label>
        <SidebarEmpty>Selection is highlighted in amber.</SidebarEmpty>
      </SidebarSection>
      {view === "hierarchy" && (
        <SidebarSection title="IFC Elements" count={state.elements.length}>
          <input
            className="ifc-element-filter"
            aria-label="Filter IFC elements"
            placeholder="Name, category or storey…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(150);
            }}
          />
          <div className="ifc-element-browser">
            {[...groups].map(([group, elements]) => (
              <details key={group} open>
                <summary>{group}</summary>
                <ul className="ifc-element-list">
                  {elements.map((element) => (
                    <li key={element.id}>
                      <button
                        type="button"
                        aria-pressed={state.selected?.id === element.id}
                        onClick={() => onSelect?.(ifcSelectionKey(element.id))}
                      >
                        <span>{element.name}</span>
                        <small>{element.category}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          {filtered.length === 0 && (
            <SidebarEmpty>No matching elements.</SidebarEmpty>
          )}
          {filtered.length > limit && (
            <button type="button" onClick={() => setLimit(limit + 150)}>
              Show more ({filtered.length - limit})
            </button>
          )}
        </SidebarSection>
      )}
      <SidebarSection title="IFC Element">
        {!state.selected ? (
          <SidebarEmpty>
            Click a building element to inspect its information.
          </SidebarEmpty>
        ) : (
          <>
            <h3 className="ifc-element-name">{state.selected.name}</h3>
            <SidebarKeyValueRows
              rows={[
                {
                  id: "category",
                  label: "Category",
                  value: state.selected.category,
                },
                { id: "storey", label: "Storey", value: state.selected.storey },
              ]}
            />
            <button type="button" onClick={() => onSelect?.(null)}>
              Clear selection
            </button>
          </>
        )}
        {state.loading && (
          <SidebarEmpty>Loading element information…</SidebarEmpty>
        )}
        {state.error && <SidebarError>{state.error}</SidebarError>}
        {state.limited && (
          <SidebarEmpty>
            Some information was omitted because the detail limit was reached.
          </SidebarEmpty>
        )}
      </SidebarSection>
      {state.sections.map((section, index) => (
        <SidebarSection
          key={index}
          title={section.name}
          collapsible
          defaultOpen={index === 0}
        >
          <SidebarKeyValueRows
            rows={section.rows.map((row, i) => ({
              id: String(i),
              label: row.name,
              value: row.value,
            }))}
          />
          {section.rows.length === 0 && (
            <SidebarEmpty>No values provided.</SidebarEmpty>
          )}
        </SidebarSection>
      ))}
    </div>
  );
}
