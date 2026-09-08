import { useState, useSyncExternalStore } from "react";
import type { PackMetadata } from "../../types/format-pack";
import {
  Button,
  SelectField,
  ListTextFilter,
  SelectableListItem,
  Disclosure,
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
      {view === "hierarchy" && (
        <SidebarSection title="IFC Elements" count={state.elements.length}>
          <ListTextFilter
            ariaLabel="Filter IFC elements"
            clearLabel="Clear element filter"
            placeholder="Name, category or storey…"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setLimit(150);
            }}
          />
          <div className="ifc-element-browser">
            {[...groups].map(([group, elements]) => (
              <Disclosure
                key={group}
                title={group}
                variant="inline"
                count={elements.length}
              >
                <ul className="ifc-element-list">
                  {elements.map((element) => (
                    <li key={element.id}>
                      <SelectableListItem
                        aria-pressed={state.selected?.id === element.id}
                        onClick={() => onSelect?.(ifcSelectionKey(element.id))}
                      >
                        <span>{element.name}</span>
                        <small>{element.category}</small>
                      </SelectableListItem>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ))}
          </div>
          {filtered.length === 0 && (
            <SidebarEmpty>No matching elements.</SidebarEmpty>
          )}
          {filtered.length > limit && (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => setLimit(limit + 150)}
            >
              Show more ({filtered.length - limit})
            </Button>
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
            <Button
              size="sm"
              variant="subtle"
              className="ifc-clear-selection"
              onClick={() => onSelect?.(null)}
            >
              Clear selection
            </Button>
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
      {view === "properties" &&
        [
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
