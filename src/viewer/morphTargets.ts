import { Mesh, Object3D } from "three";
import { resolveObjectSelectionKey } from "./selectionKeys";

export function applyMorphTargetValues(
  root: Object3D,
  values?: Record<string, Record<number, number>>,
) {
  if (!values) return;

  root.traverse((child) => {
    if (!(child instanceof Mesh) || !child.morphTargetInfluences) return;
    const selectionKey = resolveObjectSelectionKey(child);
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
