import { DoubleSide, type Material, type Mesh, type Object3D } from "three";

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

export function isMmdMaterial(material: Material): boolean {
  return material.userData?.mmdMaterial !== undefined;
}

export function copyMmdMaterialUserData(target: Material, source: Material) {
  copyMmdOutlineMaterialUserData(target, source);
  if (isMmdMaterial(source)) {
    target.userData.mmdMaterial = source.userData.mmdMaterial;
  }
}

export function syncMmdTransparentMaterialRenderState(material: Material) {
  if (isMmdOutlineMaterial(material) && material.opacity <= 0) {
    material.depthWrite = false;
  }

  if (!isMmdMaterial(material)) {
    return;
  }

  if (material.opacity <= 0 && material.colorWrite === false) {
    material.depthWrite = false;
  }

  const maybeDoubleSidedTransparent =
    material.transparent === true && material.side === DoubleSide;
  (material as Material & { forceSinglePass?: boolean }).forceSinglePass =
    maybeDoubleSidedTransparent;
}

function getMaterials(material: Material | Material[]) {
  return Array.isArray(material) ? material : [material];
}

export function syncMmdMaterialRenderStates(object: Object3D) {
  object.traverse((child) => {
    const mesh = child as Partial<Mesh>;
    const material = mesh.material;
    if (!material) {
      return;
    }
    for (const entry of getMaterials(material)) {
      syncMmdTransparentMaterialRenderState(entry);
    }
  });
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
