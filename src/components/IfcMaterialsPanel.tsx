import { MaterialBrowser } from "./MaterialBrowser";
import { useEffect, useMemo, useState } from "react";
import type { IfcInspection, IfcMaterialRecord } from "../types/ifc";
import { KeyValueRows } from "./ui/KeyValueRows";
import { Button } from "./ui/Button";
import { Disclosure } from "./ui/Disclosure";
import { SidebarEmpty, SidebarError } from "../lib/sidebarPrimitives";
import "../styles/material-list.css";
import "../styles/ifc-materials.css";

const provenance: Record<IfcMaterialRecord["origin"], string> = {
  source: "Source IFC",
  loader: "Loader output · source link unknown",
  fallback: "Viewer default (at import)",
  category: "Viewer category color",
  element: "Viewer element color",
};
const empty: readonly IfcMaterialRecord[] = [];

export function IfcMaterialsPanel({
  inspection,
}: {
  inspection: IfcInspection;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const display = useMemo(
    () =>
      (inspection.materials?.display ?? empty).filter(
        (entry) => entry.origin === "source",
      ),
    [inspection.materials],
  );
  const building = inspection.materials?.building ?? empty;
  const entries = useMemo(() => [...building, ...display], [building, display]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const filtered = entries.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const all = useMemo(
    () => new Map([...building, ...display].map((entry) => [entry.id, entry])),
    [building, display],
  );
  useEffect(() => {
    let active = true;
    void inspection
      .highlightMaterials?.(selected?.elementIds ?? [])
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      void inspection.highlightMaterials?.([]).catch(() => {});
    };
  }, [inspection, selected]);
  const choose = (entry: IfcMaterialRecord) => {
    setSelectedId(entry.id === selectedId ? null : entry.id);
    setError(null);
  };
  const navigate = (entry: IfcMaterialRecord) => {
    setSelectedId(entry.id);
    setQuery("");
  };
  const detail = selected ? (
    <div className="ifc-material-details">
      <h3>{selected.name}</h3>
      <KeyValueRows
        density="regular"
        className="selected-kv"
        rows={[
          { id: "origin", label: "Origin", value: provenance[selected.origin] },
          {
            id: "usage",
            label: "Usage",
            value: selected.elementIds.length
              ? `${selected.elementIds.length.toLocaleString()} elements`
              : selected.kind === "display"
                ? "Unassigned definition"
                : "No linked loaded elements",
          },
          ...selected.rows.map((row, index) => ({
            id: `property:${index}`,
            label: row.name,
            value: row.value,
          })),
        ]}
      />
      {selected.origin === "source" && selected.kind === "display" && (
        <SidebarEmpty>
          Source definition. It may differ from the current viewport appearance.
        </SidebarEmpty>
      )}
      <Disclosure
        title={
          selected.kind === "building"
            ? "Linked display materials"
            : "Linked building materials"
        }
        variant="inline"
      >
        {selected.linkedIds.length ? (
          selected.linkedIds.map((id) => {
            const linked = all.get(id);
            return linked ? (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                className="ifc-material-link"
                onClick={() => navigate(linked)}
              >
                {linked.name}
              </Button>
            ) : null;
          })
        ) : (
          <SidebarEmpty>No explicit source link found.</SidebarEmpty>
        )}
      </Disclosure>
      {selected.shapeIds.length > 0 && (
        <Disclosure
          title="Referenced shapes"
          count={selected.shapeIds.length}
          variant="inline"
          defaultOpen={false}
        >
          <p className="sidebar-empty">
            {selected.shapeIds.map((id) => `#${id}`).join(", ")}
          </p>
        </Disclosure>
      )}
    </div>
  ) : (
    <SidebarEmpty>Select a material to inspect its properties.</SidebarEmpty>
  );
  return (
    <MaterialBrowser
      revealSelection
      items={filtered.map((entry) => ({
        id: entry.id,
        name: entry.name,
        color: entry.color,
        count: entry.elementIds.length,
        meta: `${entry.kind === "building" ? "Building material" : `Display material · ${provenance[entry.origin]}`} · ${entry.elementIds.length ? `${entry.elementIds.length.toLocaleString()} elements` : entry.kind === "display" ? "Unassigned" : "0 elements"}`,
      }))}
      total={entries.length}
      selectedId={selected?.id ?? null}
      onSelect={(id) => {
        const entry = all.get(id);
        if (entry) choose(entry);
      }}
      query={query}
      onQueryChange={(value) => {
        setQuery(value);
      }}
      details={
        <>
          {error && <SidebarError>{error}</SidebarError>}
          {detail}
        </>
      }
    />
  );
}
