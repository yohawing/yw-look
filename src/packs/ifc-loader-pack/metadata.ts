import type { Object3D } from "three";
import type { IfcInspection } from "../../types/ifc";
const inspections = new WeakMap<Object3D, IfcInspection>();
export function registerIfcInspection(
  object: Object3D,
  inspection: IfcInspection,
) {
  inspections.set(object, inspection);
}
export function collectIfcMetadata(object: Object3D) {
  const inspection = inspections.get(object);
  return inspection ? { kind: "ifc" as const, inspection } : null;
}
