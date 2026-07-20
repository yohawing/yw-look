import { Object3D, type Material } from "three";

const SELECTION_PROXY_TARGET_KEY = "__ywSelectionProxyTarget";
const SELECTION_MATERIAL_CUSTOMIZER_KEY = "__ywSelectionMaterialCustomizer";

export type SelectionMaterialCustomizer = (material: Material) => void;

export function setSelectionProxyTarget(proxy: Object3D, target: Object3D) {
  proxy.userData[SELECTION_PROXY_TARGET_KEY] = target;
}

export function selectionProxyTarget(object: Object3D): Object3D | null {
  const target = object.userData?.[SELECTION_PROXY_TARGET_KEY];
  return target instanceof Object3D ? target : null;
}

export function isSelectionProxy(object: Object3D): boolean {
  return selectionProxyTarget(object) !== null;
}

export function setSelectionMaterialCustomizer(
  object: Object3D,
  customizer: SelectionMaterialCustomizer,
) {
  object.userData[SELECTION_MATERIAL_CUSTOMIZER_KEY] = customizer;
}

export function applySelectionMaterialCustomizer(
  object: Object3D,
  material: Material,
) {
  const customizer = object.userData?.[SELECTION_MATERIAL_CUSTOMIZER_KEY];
  if (typeof customizer === "function") {
    (customizer as SelectionMaterialCustomizer)(material);
  }
}
