import { Object3D } from "three";

const SELECTION_PROXY_TARGET_KEY = "__ywSelectionProxyTarget";

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
