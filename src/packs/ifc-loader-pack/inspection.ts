import type {
  FragmentsModel,
  ItemData,
  RawRelationData,
  SpatialTreeItem,
} from "@thatopen/fragments";
import { Color } from "three";
import type {
  IfcElement,
  IfcInspection,
  IfcInspectionSnapshot,
  IfcDetailSection,
  IfcColorMode,
  IfcMaterialCatalog,
  IfcMaterialRecord,
} from "../../types/ifc";

type InspectionModel = Pick<
  FragmentsModel,
  | "getSpatialStructure"
  | "getItemsData"
  | "getRelations"
  | "getItemsIdsWithGeometry"
  | "setColor"
  | "resetHighlight"
>;
const forwardRelations = new Set([
  "IsDefinedBy",
  "IsTypedBy",
  "HasPropertySets",
  "HasProperties",
  "Quantities",
  "HasQuantities",
  "HasAssociations",
  "Material",
  "Materials",
  "MaterialLayers",
  "ForLayerSet",
  "MaterialConstituents",
  "MaterialProfiles",
  "ForProfileSet",
  "Properties",
]);
export const ifcSelectionKey = (id: number) => `ifc:${id}`;
export function ifcAttribute(item: ItemData | undefined, name: string): string {
  const attribute = item?.[name];
  if (!attribute || Array.isArray(attribute)) return "";
  const value: unknown = attribute.value;
  if (value === null || value === undefined || value === "") return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return Array.isArray(value) ? value.map(String).join(", ") : "";
}

export async function loadIfcDetails(
  model: Pick<InspectionModel, "getItemsData" | "getRelations">,
  id: number,
  cancelled: () => boolean,
) {
  const items = new Map<number, ItemData>();
  const relations = new Map<number, RawRelationData>();
  let pending = [id];
  let limited = false;
  for (let depth = 0; pending.length && depth < 8; depth++) {
    if (cancelled()) return { sections: [], limited: false };
    const unique = [...new Set(pending)].filter((value) => !items.has(value));
    const ids = unique.slice(0, 512 - items.size);
    limited ||= ids.length < unique.length;
    if (!ids.length) break;
    const data = await model.getItemsData(ids, {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
    });
    if (cancelled()) return { sections: [], limited: false };
    const links = await model.getRelations(ids);
    for (const item of data)
      items.set(Number(ifcAttribute(item, "_localId")), item);
    pending = [];
    for (const [key, value] of links) {
      relations.set(key, value);
      for (const [name, targets] of Object.entries(value.data))
        if (forwardRelations.has(name)) pending.push(...targets);
    }
    pending = pending.filter((value) => !items.has(value));
  }
  limited ||= pending.length > 0;
  const root = items.get(id);
  const sections: IfcDetailSection[] = [
    {
      name: "Element",
      group: "Identity",
      rows: [
        { name: "GlobalId", value: ifcAttribute(root, "_guid") || "—" },
        { name: "Type", value: ifcAttribute(root, "ObjectType") || "—" },
        { name: "Tag", value: ifcAttribute(root, "Tag") || "—" },
      ],
    },
  ];
  const typeProperties = new Set<number>();
  for (const [key, item] of items) {
    if (/TYPE$/.test(ifcAttribute(item, "_category"))) {
      for (const target of relations.get(key)?.data.HasPropertySets ?? [])
        typeProperties.add(target);
    }
  }
  for (const [key, item] of items) {
    const category = ifcAttribute(item, "_category");
    if (key === id || /IFCPROPERTY(?!SET)/.test(category)) continue;
    if (
      !/TYPE$|^IFCMATERIAL|^IFCPROPERTYSET$|^IFCELEMENTQUANTITY$/.test(category)
    )
      continue;
    const rows: IfcDetailSection["rows"] = [];
    const props =
      relations.get(key)?.data.HasProperties ??
      relations.get(key)?.data.Quantities ??
      [];
    if (category === "IFCPROPERTYSET" || category === "IFCELEMENTQUANTITY") {
      for (const property of props) {
        const value = items.get(property);
        const fields = Object.keys(value ?? {}).filter((name) =>
          /Value$|Values$/.test(name),
        );
        rows.push({
          name: ifcAttribute(value, "Name") || `#${property}`,
          value:
            fields
              .map((name) => ifcAttribute(value, name))
              .filter(Boolean)
              .join(", ") || "Not provided",
        });
      }
    } else {
      for (const name of Object.keys(item))
        if (!name.startsWith("_") && name !== "Name")
          rows.push({
            name,
            value: ifcAttribute(item, name) || "Not provided",
          });
    }
    const label =
      category === "IFCPROPERTYSET"
        ? typeProperties.has(key)
          ? "Type properties"
          : "Element properties"
        : category === "IFCELEMENTQUANTITY"
          ? "Quantities"
          : category === "IFCMATERIALLAYER"
            ? "Material layer"
            : category.startsWith("IFCMATERIAL")
              ? "Material"
              : "Type";
    sections.push({
      group:
        label === "Material" || label === "Material layer"
          ? "Materials"
          : label,
      name: `${label === "Material layer" ? "Layer · " : ""}${ifcAttribute(item, "Name") || ifcAttribute(item, "LayerSetName") || `#${key}`}`,
      rows,
    });
  }
  return { sections, limited };
}

export async function createIfcInspection(
  model: InspectionModel,
  materials?: IfcMaterialCatalog,
): Promise<IfcInspection> {
  const tree = await model.getSpatialStructure();
  const geometryIds = new Set(await model.getItemsIdsWithGeometry());
  const locations = new Map<
    number,
    { category: string; storey: number | null; building: number | null }
  >();
  function visit(
    node: SpatialTreeItem,
    category = "",
    storey: number | null = null,
    building: number | null = null,
  ) {
    category = node.category ?? category;
    if (node.localId !== null) {
      if (category === "IFCBUILDINGSTOREY") storey = node.localId;
      if (category === "IFCBUILDING") building = node.localId;
      locations.set(node.localId, { category, storey, building });
    }
    for (const child of node.children ?? [])
      visit(child, category, storey, building);
  }
  visit(tree);
  const ids = [...new Set([...locations.keys(), ...geometryIds])];
  const labels = new Map<number, ItemData>();
  for (let offset = 0; offset < ids.length; offset += 256) {
    const data = await model.getItemsData(ids.slice(offset, offset + 256), {
      attributes: ["Name"],
      attributesDefault: false,
      relationsDefault: { attributes: false, relations: false },
    });
    for (const item of data)
      labels.set(Number(ifcAttribute(item, "_localId")), item);
  }
  const assignments = new Map<number, number[]>();
  for (let offset = 0; offset < ids.length; offset += 256) {
    const relations = await model.getRelations(ids.slice(offset, offset + 256));
    for (const [id, relation] of relations)
      assignments.set(id, relation.data.HasAssignments ?? []);
  }
  const groupIds = [...new Set([...assignments.values()].flat())];
  const groups = new Map<number, { id: number; name: string }>();
  for (let offset = 0; offset < groupIds.length; offset += 256) {
    const data = await model.getItemsData(
      groupIds.slice(offset, offset + 256),
      {
        attributes: ["Name"],
        attributesDefault: false,
        relationsDefault: { attributes: false, relations: false },
      },
    );
    for (const item of data) {
      if (ifcAttribute(item, "_category") !== "IFCGROUP") continue;
      const id = Number(ifcAttribute(item, "_localId"));
      groups.set(id, { id, name: ifcAttribute(item, "Name") || `#${id}` });
    }
  }
  const elements: IfcElement[] = [...geometryIds].map((id) => {
    const location = locations.get(id);
    return {
      id,
      groups: (assignments.get(id) ?? []).flatMap((id) =>
        groups.has(id) ? [groups.get(id)!] : [],
      ),
      guid: ifcAttribute(labels.get(id), "_guid"),
      name: ifcAttribute(labels.get(id), "Name") || `#${id}`,
      category:
        location?.category ||
        ifcAttribute(labels.get(id), "_category") ||
        "IFCELEMENT",
      storey:
        ifcAttribute(labels.get(location?.storey ?? -1), "Name") ||
        "Unassigned storey",
      building:
        ifcAttribute(labels.get(location?.building ?? -1), "Name") ||
        "Building",
    };
  });
  let snapshot: IfcInspectionSnapshot = {
    elements,
    selected: null,
    sections: [],
    loading: false,
    error: null,
    limited: false,
    colorMode: "original",
  };
  const listeners = new Set<() => void>();
  let disposed = false;
  let generation = 0;
  let highlights = Promise.resolve();
  let appliedMode: IfcColorMode = "original";
  let highlighted: number[] = [];
  let materialHighlight: readonly number[] = [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const tint = (ids: number[], color: string) =>
    model.setColor(ids, new Color(color));
  const queueAppearance = () => {
    highlights = highlights
      .catch(() => {})
      .then(async () => {
        if (disposed) return;
        const { colorMode, selected } = snapshot;
        if (appliedMode !== colorMode) {
          await model.resetHighlight();
          if (disposed) return;
          if (colorMode !== "original") {
            const groups = new Map<string, number[]>();
            for (const element of elements) {
              const color = ifcElementColor(element, colorMode);
              const ids = groups.get(color) ?? [];
              ids.push(element.id);
              groups.set(color, ids);
            }
            for (const [color, ids] of groups) {
              if (disposed) return;
              await tint(ids, color);
            }
          }
          appliedMode = colorMode;
          highlighted = [];
        }
        if (highlighted.length) {
          await model.resetHighlight(highlighted);
          if (disposed) return;
          if (colorMode !== "original") {
            const restore = new Map<string, number[]>();
            for (const id of highlighted) {
              const element = byId.get(id);
              if (!element) continue;
              const color = ifcElementColor(element, colorMode);
              const ids = restore.get(color) ?? [];
              ids.push(id);
              restore.set(color, ids);
            }
            for (const [color, ids] of restore) {
              if (disposed) return;
              await tint(ids, color);
            }
          }
        }
        if (disposed) return;
        if (materialHighlight.length)
          await tint([...materialHighlight], "#59d5df");
        if (disposed) return;
        if (selected) await tint([selected.id], "#ffc857");
        highlighted = [
          ...new Set([
            ...materialHighlight,
            ...(selected ? [selected.id] : []),
          ]),
        ];
      });
    return highlights;
  };
  const publish = (value: Partial<IfcInspectionSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...value };
    listeners.forEach((listener) => listener());
  };
  const active = new Set<Promise<void>>();
  const select = async (key: string | null) => {
    const operation = selectElement(key);
    active.add(operation);
    try {
      await operation;
    } finally {
      active.delete(operation);
    }
  };
  const selectElement = async (key: string | null) => {
    const token = ++generation;
    if (disposed) return;
    const selected =
      elements.find((element) => ifcSelectionKey(element.id) === key) ?? null;
    publish({
      selected,
      sections: [],
      loading: Boolean(selected),
      error: null,
      limited: false,
    });
    const cancelled = () => disposed || token !== generation;
    try {
      await queueAppearance();
      if (cancelled() || !selected) return;
      const detail = await loadIfcDetails(model, selected.id, cancelled);
      if (!cancelled()) publish({ ...detail, loading: false });
    } catch (error) {
      if (!cancelled())
        publish({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  };
  return {
    materials,
    getDisplayMaterials() {
      const definitions = materials?.display ?? [];
      if (snapshot.colorMode === "original") return definitions;
      const generated = new Map<string, IfcMaterialRecord>();
      for (const element of elements) {
        const color = ifcElementColor(element, snapshot.colorMode);
        const key =
          snapshot.colorMode === "category" ? element.category : color;
        let record = generated.get(key);
        if (!record) {
          record = {
            id: `viewer:${snapshot.colorMode}:${key}`,
            name: `${snapshot.colorMode === "category" ? "Category color" : "Element color"} · ${key}`,
            kind: "display",
            origin: snapshot.colorMode,
            rows: [
              { name: "Color", value: color },
              {
                name: "Opacity / Textures",
                value: "Inherited from import settings",
              },
            ],
            elementIds: [],
            shapeIds: [],
            linkedIds: [],
            color,
          };
          generated.set(key, record);
        }
        record.elementIds.push(element.id);
      }
      return [...generated.values(), ...definitions];
    },
    async highlightMaterials(ids) {
      if (disposed) return;
      materialHighlight = [...new Set(ids)].filter((id) => byId.has(id));
      const operation = queueAppearance();
      active.add(operation);
      try {
        await operation;
      } finally {
        active.delete(operation);
      }
    },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select,
    async setColorMode(colorMode) {
      if (disposed) return;
      publish({ colorMode });
      const operation = queueAppearance();
      active.add(operation);
      try {
        await operation;
      } catch (error) {
        publish({
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        active.delete(operation);
      }
    },
    async dispose() {
      disposed = true;
      generation++;
      listeners.clear();
      await Promise.allSettled([...active]);
    },
  };
}

const palette = [
  "#93b6d2",
  "#bba4cf",
  "#8fc4ae",
  "#ceaa91",
  "#a9b9d8",
  "#c89ba9",
  "#a3c9c5",
  "#b9c79a",
  "#d1b8a6",
  "#8fafbc",
  "#bbaac0",
  "#95b99e",
  "#c99b8e",
  "#a8acd2",
  "#8fc3cc",
  "#c2bd91",
];
export function ifcElementColor(
  element: IfcElement,
  mode: Exclude<IfcColorMode, "original">,
): string {
  const key =
    mode === "category" ? element.category : element.guid || String(element.id);
  let hash = 2166136261;
  for (const character of key)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return palette[(hash >>> 0) % palette.length];
}
