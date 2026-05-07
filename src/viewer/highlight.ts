/**
 * Mesh selection highlight (tint) for the 3-D viewport (#33).
 *
 * Strategy
 * --------
 * When a mesh is selected we clone its material(s) so shared materials are
 * never mutated.  The clone gets a small emissive tint (Accent Violet from the
 * design system) on MeshStandardMaterial / MeshPhysicalMaterial / similar, or
 * a color blend on MeshBasicMaterial.  A sentinel flag `__yw_selectionClone`
 * on the cloned material lets us identify and dispose of it when the selection
 * is cleared.
 *
 * The original material reference is stored in `userData.__yw_origMaterial`
 * on the mesh so we can restore it without keeping a separate Map.
 */

import { Color, Mesh, type Material, type Object3D } from "three";
import type { Group } from "three";

/** Accent Violet from the yw-look design system (docs/DESIGN.md). */
const SELECTION_TINT = new Color(0x7170ff);
/** Additive emissive intensity added to the original emissive value. */
const EMISSIVE_INTENSITY = 0.35;

// ─── Internal helpers ────────────────────────────────────────────────────────

/** True when `material` supports an `emissive` color property. */
function hasEmissive(
  material: Material,
): material is Material & { emissive: Color; emissiveIntensity: number } {
  return "emissive" in material;
}

/** Clone `material` and apply the selection tint.  Returns the clone. */
function cloneWithTint(material: Material): Material {
  const clone = material.clone();
  // Mark so we can identify it later for cleanup.
  clone.userData.__yw_selectionClone = true;

  if (hasEmissive(clone)) {
    // Add tint on top of whatever emissive was already there.
    const blended = clone.emissive.clone().lerp(SELECTION_TINT, 0.6);
    clone.emissive.copy(blended);
    // Ensure the emissive channel actually contributes.
    if (clone.emissiveIntensity === 0) {
      clone.emissiveIntensity = EMISSIVE_INTENSITY;
    }
  } else if ("color" in clone) {
    // MeshBasicMaterial: lerp the diffuse colour towards the tint in place.
    (clone as Material & { color: Color }).color.lerp(SELECTION_TINT, 0.3);
  }

  return clone;
}

/** Apply the selection tint to a single mesh. */
function applyTintToMesh(mesh: Mesh): void {
  if (Array.isArray(mesh.material)) {
    mesh.userData.__yw_origMaterial = mesh.material.slice();
    mesh.material = mesh.material.map(cloneWithTint);
  } else {
    mesh.userData.__yw_origMaterial = mesh.material;
    mesh.material = cloneWithTint(mesh.material);
  }
}

/** Remove the selection tint from a single mesh, restoring the original. */
function removeTintFromMesh(mesh: Mesh): void {
  const orig = mesh.userData.__yw_origMaterial as
    | Material
    | Material[]
    | undefined;
  if (!orig) return;

  // Dispose the cloned material(s) to free GPU resources.
  if (Array.isArray(mesh.material)) {
    for (const m of mesh.material) {
      if (m.userData.__yw_selectionClone) m.dispose();
    }
  } else {
    if ((mesh.material as Material).userData.__yw_selectionClone) {
      mesh.material.dispose();
    }
  }

  mesh.material = orig as Mesh["material"];
  delete mesh.userData.__yw_origMaterial;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Walk `root` and apply the selection tint to Mesh nodes whose
 * selection key matches `key`.
 *
 * The selection key is resolved as:
 *   1. `child.userData.primPath` (USD primPath, set by #46 hierarchy GLB)
 *   2. `child.name` (trimmed) — fallback for non-USD assets or old GLB
 *
 * Call {@link clearSelectionHighlight} first if a previous selection is still
 * active to avoid leaking cloned materials.
 */
export function applySelectionHighlight(
  root: Object3D | Group,
  key: string,
): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (child.name === "__yw_shadow_catcher") return;
    // Prefer primPath as the stable selection key (#46).
    const primPath =
      typeof child.userData?.primPath === "string"
        ? child.userData.primPath
        : undefined;
    const matchKey =
      primPath ?? (typeof child.name === "string" ? child.name.trim() : "");
    // Unnamed meshes without a primPath are not selectable.
    if (matchKey.length === 0) return;
    if (matchKey === key) {
      applyTintToMesh(child);
    }
  });
}

/**
 * Walk `root` and remove the selection tint from every Mesh that was
 * previously tinted (detected by `userData.__yw_origMaterial`).
 */
export function clearSelectionHighlight(root: Object3D | Group): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (child.userData.__yw_origMaterial !== undefined) {
      removeTintFromMesh(child);
    }
  });
}
