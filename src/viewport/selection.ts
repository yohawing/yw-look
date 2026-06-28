import { Mesh, Object3D } from "three";
import type { PurposeModes } from "../lib/usd";
import { isViewportHelperObject, selectionProxyTarget } from "../viewer";
import { resolveObjectSelectionKey } from "../viewer/selectionKeys";

export const MANUAL_HIDDEN_KEY = "__ywManualHidden";

export function selectionKeyForObject(object: Object3D) {
  const proxyTarget = selectionProxyTarget(object);
  if (proxyTarget) {
    return selectionKeyForObject(proxyTarget);
  }
  return resolveObjectSelectionKey(object);
}

export function findObjectBySelectionKey(
  root: Object3D,
  selectionKey: string,
): Object3D | null {
  let match: Object3D | null = null;

  root.traverse((child) => {
    if (match) return;
    if (selectionKeyForObject(child) === selectionKey) {
      match = child;
    }
  });

  return match;
}

export function isSelectablePickTarget(object: Object3D): object is Mesh {
  return (
    object instanceof Mesh &&
    object.name !== "__yw_shadow_catcher" &&
    !isViewportHelperObject(object) &&
    selectionKeyForObject(object) !== null
  );
}

export function collectSelectablePickTargets(root: Object3D): Mesh[] {
  const targets: Mesh[] = [];
  root.traverse((child) => {
    if (isSelectablePickTarget(child)) {
      targets.push(child);
    }
  });
  return targets;
}

export function isManuallyHidden(object: Object3D) {
  return object.userData?.[MANUAL_HIDDEN_KEY] === true;
}

export function setSubtreeManualHidden(root: Object3D, hidden: boolean) {
  root.traverse((child) => {
    if (child.name === "__yw_shadow_catcher") {
      return;
    }
    if (hidden) {
      child.userData[MANUAL_HIDDEN_KEY] = true;
    } else {
      delete child.userData[MANUAL_HIDDEN_KEY];
    }
  });

  const parent = root.parent;
  if (!parent) {
    return;
  }
  parent.traverse((child) => {
    if (selectionProxyTarget(child) !== root) {
      return;
    }
    if (hidden) {
      child.userData[MANUAL_HIDDEN_KEY] = true;
    } else {
      delete child.userData[MANUAL_HIDDEN_KEY];
    }
  });
}

export function applyManualVisibility(root: Object3D) {
  root.traverse((child) => {
    if (child.name === "__yw_shadow_catcher") {
      return;
    }
    if (isManuallyHidden(child)) {
      child.visible = false;
    }
  });
}

export function isolateObject(root: Object3D, selected: Object3D) {
  setSubtreeManualHidden(root, true);
  setSubtreeManualHidden(selected, false);

  let ancestor = selected.parent;
  while (ancestor && ancestor !== root.parent) {
    delete ancestor.userData[MANUAL_HIDDEN_KEY];
    if (ancestor === root) break;
    ancestor = ancestor.parent;
  }
}

export function applyPurposeVisibility(
  root: Object3D,
  modes: PurposeModes | undefined,
) {
  const render = modes?.render ?? true;
  const proxy = modes?.proxy ?? false;
  const guide = modes?.guide ?? false;

  root.traverse((child) => {
    const purpose: unknown = child.userData?.purpose;
    if (typeof purpose !== "string") return;

    let visible: boolean;
    switch (purpose) {
      case "default":
        visible = true;
        break;
      case "render":
        visible = render;
        break;
      case "proxy":
        visible = proxy;
        break;
      case "guide":
        visible = guide;
        break;
      default:
        visible = true;
    }
    child.visible = visible && !isManuallyHidden(child);
  });
}
