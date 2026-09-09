import * as IFC from "web-ifc";
import type { IfcMaterialCatalog, IfcMaterialRecord } from "../../types/ifc";
import { throwIfAborted } from "../abort";

type Line = Record<string, unknown>;
export type MaterialReader = {
  ids: (type: number) => number[];
  get: (id: number) => Line;
};
function object(value: unknown): Line | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Line)
    : null;
}
function scalar(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  const item = object(value);
  if (item) return item.type === 5 ? "" : scalar(item.value);
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : "";
}
function refs(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  const item = object(value);
  return item?.type === 5 && typeof item.value === "number" ? [item.value] : [];
}
function rows(line: Line) {
  return Object.entries(line).flatMap(([name, value]) => {
    const text = scalar(value);
    return !["expressID", "type", "Name"].includes(name) && text !== ""
      ? [{ name, value: text }]
      : [];
  });
}
function record(
  id: number,
  line: Line,
  kind: "building" | "display",
): IfcMaterialRecord {
  return {
    id: `${kind}:${id}`,
    name: scalar(line.Name) || `#${id}`,
    kind,
    origin: "source",
    rows: rows(line),
    elementIds: [],
    shapeIds: [],
    linkedIds: [],
    color: null,
  };
}
const materialFields = [
  "Material",
  "Materials",
  "MaterialLayers",
  "ForLayerSet",
  "MaterialConstituents",
  "MaterialProfiles",
  "ForProfileSet",
];

/** Follow IFC references, never names or colour equality, to build the material index. */
export function collectIfcMaterials(
  reader: MaterialReader,
  renderedIds: readonly number[],
): IfcMaterialCatalog {
  const { get, ids } = reader;
  const building = new Map(
    ids(IFC.IFCMATERIAL).map((id) => [id, record(id, get(id), "building")]),
  );
  const display = new Map(
    ids(IFC.IFCSURFACESTYLE).map((id) => [id, record(id, get(id), "display")]),
  );
  const associations = new Map<number, number[]>();
  for (const id of ids(IFC.IFCRELASSOCIATESMATERIAL)) {
    const line = get(id);
    for (const owner of refs(line.RelatedObjects))
      associations.set(owner, [
        ...(associations.get(owner) ?? []),
        ...refs(line.RelatingMaterial),
      ]);
  }
  const types = new Map<number, number[]>();
  for (const id of ids(IFC.IFCRELDEFINESBYTYPE)) {
    const line = get(id);
    for (const owner of refs(line.RelatedObjects))
      types.set(owner, refs(line.RelatingType));
  }
  const materialsFor = (roots: number[]) => {
    const found = new Set<number>();
    const seen = new Set<number>();
    const pending = [...roots];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (building.has(id)) {
        found.add(id);
        continue;
      }
      const line = get(id);
      for (const field of materialFields) pending.push(...refs(line[field]));
    }
    return found;
  };
  for (const id of renderedIds) {
    // An occurrence's association takes precedence over the type's default.
    const roots =
      associations.get(id) ??
      (types.get(id) ?? []).flatMap((type) => associations.get(type) ?? []);
    for (const material of materialsFor(roots))
      building.get(material)!.elementIds.push(id);
  }
  for (const id of ids(IFC.IFCMATERIALPROPERTIES)) {
    const line = get(id);
    for (const target of refs(line.Material)) {
      const material = building.get(target);
      if (!material) continue;
      material.rows.push(...rows(line));
      for (const property of refs(line.Properties ?? line.ExtendedProperties)) {
        const value = get(property);
        material.rows.push({
          name: scalar(value.Name) || `#${property}`,
          value:
            scalar(value.NominalValue ?? value.ListValues) || "Not provided",
        });
      }
    }
  }
  const colour = (value: unknown): string | null => {
    const id = refs(value)[0];
    if (id === undefined) return null;
    const line = get(id);
    const rgb = [line.Red, line.Green, line.Blue].map((v) => Number(scalar(v)));
    if (
      [line.Red, line.Green, line.Blue].some((v) => v == null) ||
      rgb.some((v) => !Number.isFinite(v))
    )
      return null;
    return (
      "#" +
      rgb
        .map((v) =>
          Math.round(Math.max(0, Math.min(1, v)) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  };
  for (const [id, style] of display) {
    const textureIds = new Set<number>();
    for (const part of refs(get(id).Styles)) {
      const line = get(part);
      const rgb = colour(line.SurfaceColour);
      if (rgb) {
        style.color = rgb;
        style.rows.push({ name: "SurfaceColour", value: rgb });
      }
      style.rows.push(...rows(line));
      for (const field of [
        "DiffuseColour",
        "SpecularColour",
        "ReflectionColour",
        "TransmissionColour",
      ]) {
        const value = colour(line[field]);
        if (value) style.rows.push({ name: field, value });
      }
      for (const textureId of refs(line.Textures)) {
        textureIds.add(textureId);
        const texture = get(textureId);
        style.rows.push(
          {
            name: `Texture #${textureId}`,
            value:
              scalar(texture.URLReference) || "Embedded / procedural texture",
          },
          ...rows(texture),
        );
      }
    }
    style.rows.push({ name: "Textures", value: String(textureIds.size) });
    if (!style.rows.some((row) => row.name === "Transparency"))
      style.rows.push({ name: "Transparency", value: "Not specified" });
  }
  const stylesFor = (roots: number[]) => {
    const result = new Set<number>();
    const seen = new Set<number>();
    const pending = [...roots];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (display.has(id)) {
        result.add(id);
        continue;
      }
      const line = get(id);
      for (const field of ["Representations", "Items", "Styles"])
        pending.push(...refs(line[field]));
    }
    return result;
  };
  for (const id of ids(IFC.IFCMATERIALDEFINITIONREPRESENTATION)) {
    const line = get(id);
    for (const materialId of refs(line.RepresentedMaterial)) {
      const material = building.get(materialId);
      if (!material) continue;
      for (const styleId of stylesFor(refs(line.Representations))) {
        const style = display.get(styleId)!;
        material.linkedIds.push(style.id);
        style.linkedIds.push(material.id);
        // This is a material association, not proof of a separately selectable layer shape.
        style.elementIds.push(...material.elementIds);
      }
    }
  }
  const stylesByShape = new Map<number, Set<number>>();
  for (const id of ids(IFC.IFCSTYLEDITEM)) {
    const line = get(id);
    const styles = stylesFor(refs(line.Styles));
    for (const shape of refs(line.Item)) {
      const targets = stylesByShape.get(shape) ?? new Set();
      for (const style of styles) {
        targets.add(style);
        display.get(style)!.shapeIds.push(shape);
      }
      stylesByShape.set(shape, targets);
    }
  }
  if (stylesByShape.size) {
    for (const element of renderedIds) {
      const seen = new Set<number>();
      const pending = refs(get(element).Representation);
      while (pending.length) {
        const id = pending.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const style of stylesByShape.get(id) ?? [])
          display.get(style)!.elementIds.push(element);
        // Traverse only forward shape ownership. Placement/context references are not owners.
        const line = get(id);
        for (const field of [
          "Representations",
          "Items",
          "MappingSource",
          "MappedRepresentation",
          "FirstOperand",
          "SecondOperand",
          "Outer",
          "CfsFaces",
          "FbsmFaces",
          "SbsmBoundary",
          "Bounds",
          "Bound",
        ])
          pending.push(...refs(line[field]));
      }
    }
  }
  for (const entry of [...building.values(), ...display.values()]) {
    entry.elementIds = [...new Set(entry.elementIds)];
    entry.shapeIds = [...new Set(entry.shapeIds)];
    entry.linkedIds = [...new Set(entry.linkedIds)];
  }
  return { building: [...building.values()], display: [...display.values()] };
}

/** A metadata-only pass: the importer does not retain unassigned surface-style definitions. */
export async function readIfcMaterials(
  bytes: Uint8Array,
  wasmUrl: string,
  renderedIds: readonly number[],
  signal?: AbortSignal,
): Promise<IfcMaterialCatalog> {
  const api = new IFC.IfcAPI();
  let model: number | null = null;
  try {
    await api.Init(() => wasmUrl);
    throwIfAborted(signal);
    model = api.OpenModel(bytes);
    if (model < 0) throw new Error("IFC material metadata could not be opened");
    const cache = new Map<number, Line>();
    const modelId = model;
    const result = collectIfcMaterials(
      {
        ids: (type) => {
          throwIfAborted(signal);
          const values = api.GetLineIDsWithType(modelId, type, true);
          return Array.from({ length: values.size() }, (_, i) => values.get(i));
        },
        get: (id) => {
          let line = cache.get(id);
          if (!line) {
            line = api.GetLine(modelId, id, false, false) as Line;
            cache.set(id, line ?? {});
          }
          return line ?? {};
        },
      },
      renderedIds,
    );
    throwIfAborted(signal);
    return result;
  } finally {
    if (model !== null && model >= 0) api.CloseModel(model);
    api.Dispose();
  }
}
