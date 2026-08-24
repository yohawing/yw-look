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

import { Mesh, type Material, type Object3D } from "three";
import type { Group } from "three";
import {
  clearNormalSurfaceSelection,
  createSelectionTintMaterialSet,
  getNormalSurfaceOriginalMaterial,
  isNormalSurfaceMaterialActive,
  isViewportHelperObject,
  storeSuppressedNormalSelectionTint,
} from "./scene";
import { isSelectionProxy } from "./selectionProxy";
import { resolveObjectSelectionKey } from "./selectionKeys";

// ─── Internal helpers ────────────────────────────────────────────────────────

function shouldHighlightMesh(mesh: Mesh): boolean {
  return (
    mesh.name !== "__yw_shadow_catcher" &&
    !isViewportHelperObject(mesh) &&
    !isSelectionProxy(mesh)
  );
}

/** Clone `material` and apply the selection tint.  Returns the clone. */
function cloneWithTint(material: Material): Material {
  return createSelectionTintMaterialSet(material) as Material;
}

/** Apply the selection tint to a single mesh. */
function applyTintToMesh(mesh: Mesh): void {
  // MeshNormalMaterial already consumes RGB to visualize view-space normals;
  // a color/emissive selection tint cannot be represented meaningfully. Keep
  // selection lifecycle state without replacing the active normal material.
  if (isNormalSurfaceMaterialActive(mesh)) {
    const original = getNormalSurfaceOriginalMaterial(mesh);
    if (original !== undefined) {
      storeSuppressedNormalSelectionTint(
        mesh,
        createSelectionTintMaterialSet(original),
      );
    }
    return;
  }
  if (Array.isArray(mesh.material)) {
    mesh.userData.__yw_origMaterial = mesh.material;
    mesh.material = mesh.material.map(cloneWithTint);
  } else {
    mesh.userData.__yw_origMaterial = mesh.material;
    mesh.material = cloneWithTint(mesh.material);
  }
}

/** Remove the selection tint from a single mesh, restoring the original. */
function removeTintFromMesh(mesh: Mesh): void {
  const orig = mesh.userData.__yw_origMaterial as
    Material | Material[] | undefined;
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
    if (!shouldHighlightMesh(child)) return;
    const matchKey = resolveObjectSelectionKey(child);
    // Unnamed meshes without a primPath are not selectable.
    if (matchKey === null) return;
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
    if (clearNormalSurfaceSelection(child)) {
      return;
    }
    if (child.userData.__yw_origMaterial !== undefined) {
      removeTintFromMesh(child);
    }
  });
}

export function applySelectionHighlightToObject(
  object: Object3D | Group,
): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (!shouldHighlightMesh(child)) return;
    if (
      child.userData.__yw_origMaterial !== undefined ||
      child.userData.__yw_selectionSuppressedByNormals === true
    )
      return;
    applyTintToMesh(child);
  });
}

export function clearSelectionHighlightFromObject(
  object: Object3D | Group,
): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (clearNormalSurfaceSelection(child)) {
      return;
    }
    if (child.userData.__yw_origMaterial !== undefined) {
      removeTintFromMesh(child);
    }
  });
}
