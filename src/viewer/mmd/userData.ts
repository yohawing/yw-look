import type { Material, Mesh, Object3D } from "three";

export const MMD_MODEL_KEY = "__ywMmdModel";

export function isMmdOutlineMaterial(material: Material): boolean {
  return material.userData?.mmdOutlineMaterial !== undefined;
}

export function copyMmdOutlineMaterialUserData(
  target: Material,
  source: Material,
) {
  if (isMmdOutlineMaterial(source)) {
    target.userData.mmdOutlineMaterial = source.userData.mmdOutlineMaterial;
  }
}

export function isMmdProxyObject(object: Object3D): boolean {
  return (
    isMmdOutlineProxyObject(object) ||
    object.userData?.mmdMaterialRenderProxy !== undefined
  );
}

export function isMmdOutlineProxyObject(object: Object3D): boolean {
  return object.userData?.mmdOutlineProxy !== undefined;
}

export function isInternalMmdProxyObject(object: Object3D): boolean {
  if (isMmdProxyObject(object)) return true;
  const mesh = object as Partial<Mesh>;
  const material = mesh.material;
  if (!material) return false;
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => isMmdOutlineMaterial(entry as Material));
}
