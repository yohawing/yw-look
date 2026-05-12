import { Mesh, Object3D } from "three";

function selectionKeyForObject(object: Object3D) {
  const primPath =
    typeof object.userData?.primPath === "string"
      ? object.userData.primPath
      : undefined;
  const raw = typeof object.name === "string" ? object.name.trim() : "";
  return primPath ?? (raw.length > 0 ? raw : null);
}

export function applyMorphTargetValues(
  root: Object3D,
  values?: Record<string, Record<number, number>>,
) {
  if (!values) return;

  root.traverse((child) => {
    if (!(child instanceof Mesh) || !child.morphTargetInfluences) return;
    const selectionKey = selectionKeyForObject(child);
    if (!selectionKey) return;
    const targetValues = values[selectionKey];
    if (!targetValues) return;

    for (const [indexText, value] of Object.entries(targetValues)) {
      const index = Number(indexText);
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < child.morphTargetInfluences.length &&
        Number.isFinite(value)
      ) {
        child.morphTargetInfluences[index] = Math.min(1, Math.max(0, value));
      }
    }
  });
}
