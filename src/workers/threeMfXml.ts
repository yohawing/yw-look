import {
  DOMParser,
  XMLSerializer,
  onWarningStopParsing,
  type Document,
  type Element,
} from "@xmldom/xmldom";
import { THREE_MF_LIMITS, packagePath } from "./threeMfArchive";

const CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const MATERIAL =
  "http://schemas.microsoft.com/3dmanufacturing/material/2015/02";
const MODEL_REL =
  "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const units: Record<string, number> = {
  micron: 0.000001,
  millimeter: 0.001,
  centimeter: 0.01,
  inch: 0.0254,
  foot: 0.3048,
  meter: 1,
};

export function parseThreeMfXml(source: string): Document {
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source))
    throw new Error("3MF: DTD and entity declarations are not supported");
  return new DOMParser({ onError: onWarningStopParsing }).parseFromString(
    source,
    "application/xml",
  );
}

export function elements(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", name));
}

/** Only the tag/descendant selectors used by ThreeMFLoader; no browser DOM is installed. */
class LoaderXmlNode {
  constructor(readonly node: Document | Element) {}
  get nodeName() {
    return this.node.nodeType === 9
      ? "#document"
      : (this.node as Element).localName;
  }
  get documentElement() {
    return new LoaderXmlNode((this.node as Document).documentElement!);
  }
  get attributes() {
    return Array.from((this.node as Element).attributes);
  }
  get children() {
    return Array.from(this.node.childNodes)
      .filter((node) => node.nodeType === 1)
      .map((node) => new LoaderXmlNode(node as Element));
  }
  get textContent() {
    return this.node.textContent;
  }
  getAttribute(name: string) {
    return (this.node as Element).getAttribute(name);
  }
  querySelectorAll(selector: string): LoaderXmlNode[] {
    const tags = selector.split(" ");
    let nodes: Array<Document | Element> = [this.node];
    for (const tag of tags) {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(tag))
        throw new Error(`3MF: unsupported loader XML selector: ${selector}`);
      nodes = nodes.flatMap((node) => elements(node, tag));
    }
    return nodes.map((node) => new LoaderXmlNode(node));
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class ThreeMfWorkerDOMParser {
  parseFromString(source: string) {
    return new LoaderXmlNode(parseThreeMfXml(source));
  }
}

function integer(value: string | null, label: string, minimum = 0): number {
  if (value === null || !/^\d+$/.test(value))
    throw new Error(`3MF: invalid ${label}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum)
    throw new Error(`3MF: invalid ${label}`);
  return number;
}

function transform(node: Element) {
  const value = node.getAttribute("transform");
  if (value === null) return;
  const numbers = value.trim().split(/\s+/).map(Number);
  if (
    numbers.length !== 12 ||
    numbers.some((number) => !Number.isFinite(number) || Math.abs(number) > 1e9)
  )
    throw new Error("3MF: invalid component/build transform");
  const determinant =
    numbers[0] * (numbers[4] * numbers[8] - numbers[5] * numbers[7]) -
    numbers[1] * (numbers[3] * numbers[8] - numbers[5] * numbers[6]) +
    numbers[2] * (numbers[3] * numbers[7] - numbers[4] * numbers[6]);
  if (determinant === 0)
    throw new Error("3MF: singular component/build transform");
  // ThreeMFLoader tokenizes with a single-space delimiter. Canonicalize valid
  // input before the validated XML is repackaged so harmless XML whitespace
  // cannot become empty tokens and NaN matrix elements downstream.
  node.setAttribute("transform", numbers.join(" "));
}

export function validateThreeMfModel(files: Record<string, Uint8Array>) {
  const warnings = new Set<string>();
  const documents = new Map<string, Document>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const [name, bytes] of Object.entries(files)) {
    if (!/\.(xml|rels|model)$/i.test(name)) continue;
    if (bytes.length > THREE_MF_LIMITS.xmlBytes)
      throw new Error("3MF: XML part exceeds 16 MiB");
    const doc = parseThreeMfXml(decoder.decode(bytes));
    const nodes = elements(doc, "*");
    if (nodes.length > 500_000) throw new Error("3MF: XML node limit exceeded");
    for (const node of nodes) {
      let depth = 0,
        parent = node.parentNode;
      while (parent) {
        if (++depth > THREE_MF_LIMITS.depth)
          throw new Error("3MF: XML nesting limit exceeded");
        parent = parent.parentNode;
      }
    }
    documents.set(name, doc);
  }
  if (!documents.has("[Content_Types].xml"))
    throw new Error("3MF: missing content types");
  const rootRels = documents.get("_rels/.rels");
  if (!rootRels) throw new Error("3MF: missing package relationships");
  let modelName: string | undefined;
  for (const [name, doc] of documents) {
    if (!name.endsWith(".rels")) continue;
    const ids = new Set<string>();
    const base =
      name === "_rels/.rels"
        ? ""
        : name.slice(0, name.lastIndexOf("/_rels/") + 1);
    for (const rel of elements(doc, "Relationship")) {
      const id = rel.getAttribute("Id"),
        target = rel.getAttribute("Target"),
        type = rel.getAttribute("Type");
      if (
        !id ||
        ids.has(id) ||
        !target ||
        !type ||
        (rel.getAttribute("TargetMode") ?? "Internal") !== "Internal"
      )
        throw new Error("3MF: invalid, duplicate, or external relationship");
      ids.add(id);
      const part = packagePath(target.startsWith("/") ? target : base + target);
      if (!files[part])
        throw new Error(`3MF: missing relationship target: ${part}`);
      rel.setAttribute("Target", `/${part}`);
      if (
        name === "_rels/.rels" &&
        part.endsWith(".model") &&
        type !== MODEL_REL
      )
        throw new Error("3MF: ambiguous root model relationship");
      if (name === "_rels/.rels" && type === MODEL_REL) {
        if (modelName)
          throw new Error("3MF: multiple root model relationships");
        modelName = part;
      }
    }
  }
  const doc = modelName ? documents.get(modelName) : undefined;
  const model = doc?.documentElement;
  if (
    !modelName ||
    !doc ||
    !model ||
    model.localName !== "model" ||
    model.namespaceURI !== CORE
  )
    throw new Error("3MF: missing or invalid Core model");
  if (!/^3D\/[^/]+\.model$/.test(modelName))
    throw new Error("3MF: root model path is unsupported");
  const unit = model.getAttribute("unit") ?? "millimeter";
  if (!Object.hasOwn(units, unit))
    throw new Error(`3MF: unsupported unit: ${unit}`);
  const supportedNamespaces = new Set([CORE, MATERIAL]);
  for (const prefix of (model.getAttribute("requiredextensions") ?? "")
    .split(/\s+/)
    .filter(Boolean)) {
    if (!supportedNamespaces.has(model.lookupNamespaceURI(prefix) ?? ""))
      throw new Error(`3MF: required extension is unsupported: ${prefix}`);
  }
  const knownTags = new Set([
    "model",
    "metadata",
    "resources",
    "object",
    "mesh",
    "vertices",
    "vertex",
    "triangles",
    "triangle",
    "components",
    "component",
    "build",
    "item",
    "basematerials",
    "base",
    "texture2d",
    "texture2dgroup",
    "tex2coord",
    "colorgroup",
    "color",
    "pbmetallicdisplayproperties",
    "pbmetallic",
  ]);
  for (const node of elements(doc, "*")) {
    if (
      !supportedNamespaces.has(node.namespaceURI ?? "") ||
      !knownTags.has(node.localName ?? "")
    ) {
      if (warnings.size < 32)
        warnings.add(`3MF: unsupported element ${node.nodeName}`);
      else
        warnings.add(
          "3MF: additional unsupported elements were omitted from this warning list",
        );
      node.parentNode?.removeChild(node);
    }
  }
  for (const name of documents.keys()) {
    if (name.endsWith(".model") && name !== modelName)
      throw new Error("3MF: external model components are not supported");
  }
  const resources = elements(model, "resources")[0];
  if (!resources) throw new Error("3MF: missing resources");
  const ids = new Map<number, Element>();
  for (const node of Array.from(resources.childNodes).filter(
    (node) => node.nodeType === 1,
  ) as Element[]) {
    const id = integer(node.getAttribute("id"), "resource id", 1);
    if (ids.has(id)) throw new Error("3MF: duplicate resource id");
    ids.set(id, node);
    if (ids.size > THREE_MF_LIMITS.instances)
      throw new Error("3MF: resource count limit exceeded");
  }
  for (const base of elements(model, "base"))
    if (
      !/^#[\da-f]{6}([\da-f]{2})?$/i.test(
        base.getAttribute("displaycolor") ?? "",
      )
    )
      throw new Error("3MF: invalid base material color");
  for (const color of elements(model, "color")) {
    const value = color.getAttribute("color") ?? "";
    if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))
      throw new Error("3MF: invalid vertex color");
    if (value.length === 9 && value.slice(7).toLowerCase() !== "ff")
      warnings.add("3MF: vertex color alpha is not supported");
  }
  for (const property of elements(model, "pbmetallic"))
    for (const key of ["metallicness", "roughness"]) {
      const text = property.getAttribute(key),
        value = Number(text);
      if (!text?.trim() || !Number.isFinite(value) || value < 0 || value > 1)
        throw new Error("3MF: invalid metallic display property");
    }
  let vertices = 0,
    triangles = 0;
  const propertyCounts = new Map<number, number>();
  for (const [id, resource] of ids) {
    const entryName = (
      {
        basematerials: "base",
        colorgroup: "color",
        texture2dgroup: "tex2coord",
      } as Record<string, string>
    )[resource.localName ?? ""];
    if (entryName) {
      const count = elements(resource, entryName).length;
      if (entryName !== "tex2coord" && count > THREE_MF_LIMITS.instances)
        throw new Error("3MF: material/color count limit exceeded");
      propertyCounts.set(id, count);
    }
  }
  const objects = new Map<
    number,
    { triangles: number; components: number[] }
  >();
  for (const object of elements(resources, "object")) {
    const id = integer(object.getAttribute("id"), "object id", 1);
    const mesh = elements(object, "mesh")[0];
    const components = elements(object, "component");
    if (Boolean(mesh) === Boolean(components.length))
      throw new Error("3MF: object must contain a mesh or components");
    if (mesh) {
      const points = elements(mesh, "vertex");
      const faces = elements(mesh, "triangle");
      vertices += points.length;
      triangles += faces.length;
      if (
        !points.length ||
        !faces.length ||
        vertices > THREE_MF_LIMITS.vertices ||
        triangles > THREE_MF_LIMITS.triangles
      )
        throw new Error("3MF: mesh is empty or exceeds geometry limits");
      for (const point of points)
        for (const axis of ["x", "y", "z"]) {
          const text = point.getAttribute(axis),
            value = Number(text);
          if (!text?.trim() || !Number.isFinite(value) || Math.abs(value) > 1e9)
            throw new Error("3MF: invalid vertex coordinate");
        }
      for (const face of faces) {
        for (const key of ["v1", "v2", "v3"])
          if (
            integer(face.getAttribute(key), "triangle index") >= points.length
          )
            throw new Error("3MF: triangle index is outside the vertex array");
        const pidText = face.getAttribute("pid") ?? object.getAttribute("pid");
        if (pidText !== null) {
          const resource = ids.get(integer(pidText, "property resource", 1));
          if (!resource) throw new Error("3MF: missing property resource");
          const count = propertyCounts.get(
            integer(pidText, "property resource", 1),
          );
          if (count === undefined)
            throw new Error(
              `3MF: unsupported property resource: ${resource.localName}`,
            );
          const first =
            face.getAttribute("p1") ?? object.getAttribute("pindex");
          for (const value of [
            first,
            face.getAttribute("p2") ?? first,
            face.getAttribute("p3") ?? first,
          ])
            if (integer(value, "property index") >= count)
              throw new Error("3MF: property index is out of bounds");
        }
      }
    }
    objects.set(id, {
      triangles: mesh ? elements(mesh, "triangle").length : 0,
      components: components.map((component) => {
        transform(component);
        if (
          Array.from(component.attributes).some(
            (attribute) =>
              attribute.localName === "path" && attribute.namespaceURI,
          )
        )
          throw new Error("3MF: external component paths are unsupported");
        return integer(
          component.getAttribute("objectid"),
          "component object id",
          1,
        );
      }),
    });
  }
  const active = new Set<number>(),
    counts = new Map<
      number,
      { triangles: number; instances: number; depth: number }
    >();
  const countObject = (
    id: number,
    depth = 0,
  ): { triangles: number; instances: number; depth: number } => {
    if (active.has(id) || depth > THREE_MF_LIMITS.depth)
      throw new Error("3MF: cyclic or deeply nested components");
    const cached = counts.get(id);
    if (cached) return cached;
    const object = objects.get(id);
    if (!object) throw new Error("3MF: missing component/build object");
    active.add(id);
    let triangles = object.triangles,
      instances = 1,
      subtreeDepth = 1;
    for (const child of object.components) {
      const count = countObject(child, depth + 1);
      triangles += count.triangles;
      instances += count.instances;
      subtreeDepth = Math.max(subtreeDepth, count.depth + 1);
    }
    active.delete(id);
    if (
      triangles > THREE_MF_LIMITS.triangles ||
      instances > THREE_MF_LIMITS.instances ||
      subtreeDepth > THREE_MF_LIMITS.depth
    )
      throw new Error("3MF: expanded component limit exceeded");
    const count = { triangles, instances, depth: subtreeDepth };
    counts.set(id, count);
    return count;
  };
  // The upstream loader constructs every resource, including unused assemblies.
  let resourceTriangles = 0,
    resourceInstances = 0;
  for (const id of objects.keys()) {
    const count = countObject(id);
    resourceTriangles += count.triangles;
    resourceInstances += count.instances;
    if (
      resourceTriangles > THREE_MF_LIMITS.triangles ||
      resourceInstances > THREE_MF_LIMITS.instances
    )
      throw new Error("3MF: expanded resource limit exceeded");
  }
  const items = elements(model, "item");
  if (!items.length) throw new Error("3MF: build is empty");
  let expandedTriangles = 0,
    instances = 0;
  for (const item of items) {
    transform(item);
    const count = countObject(
      integer(item.getAttribute("objectid"), "build object id", 1),
    );
    expandedTriangles += count.triangles;
    instances += count.instances;
  }
  if (
    expandedTriangles > THREE_MF_LIMITS.triangles ||
    instances > THREE_MF_LIMITS.instances
  )
    throw new Error("3MF: build instance limit exceeded");
  for (const texture of elements(model, "texture2d")) {
    const name = packagePath(texture.getAttribute("path") ?? "");
    if (!/^3D\/Textures?\//.test(name) || !files[name])
      throw new Error(`3MF: missing or unsupported texture path: ${name}`);
    if (
      !["image/png", "image/jpeg"].includes(
        texture.getAttribute("contenttype") ?? "",
      )
    )
      throw new Error("3MF: only PNG/JPEG textures are supported");
    const rels = documents.get(`3D/_rels/${modelName.slice(3)}.rels`);
    if (
      !rels ||
      !elements(rels, "Relationship").some(
        (rel) => rel.getAttribute("Target") === `/${name}`,
      )
    )
      throw new Error("3MF: texture relationship is missing");
    texture.setAttribute("path", `/${name}`);
  }
  for (const group of elements(model, "texture2dgroup")) {
    if (
      ids.get(integer(group.getAttribute("texid"), "texture id", 1))
        ?.localName !== "texture2d"
    )
      throw new Error("3MF: missing texture resource");
    for (const point of elements(group, "tex2coord"))
      for (const axis of ["u", "v"])
        if (
          point.getAttribute(axis) === null ||
          !Number.isFinite(Number(point.getAttribute(axis)))
        )
          throw new Error("3MF: invalid texture coordinate");
  }
  const serializer = new XMLSerializer(),
    encoder = new TextEncoder();
  for (const [name, document] of documents)
    if (name.endsWith(".rels"))
      files[name] = encoder.encode(serializer.serializeToString(document));
  files[modelName] = encoder.encode(serializer.serializeToString(doc));
  return { unit, metersPerUnit: units[unit], warnings: [...warnings] };
}
