import type { Object3D } from "three";

const OBJECT_SELECTION_KEY = "__ywSelectionKey";

export function setObjectSelectionKey(object: Object3D, key: string) {
  object.userData[OBJECT_SELECTION_KEY] = key;
}

export function explicitObjectSelectionKey(
  object: Object3D,
): string | undefined {
  const key = object.userData?.[OBJECT_SELECTION_KEY];
  return typeof key === "string" && key.trim().length > 0
    ? key.trim()
    : undefined;
}

export function resolveObjectSelectionKey(object: Object3D): string | null {
  const explicitKey = explicitObjectSelectionKey(object);
  if (explicitKey) {
    return explicitKey;
  }
  const primPath =
    typeof object.userData?.primPath === "string"
      ? object.userData.primPath
      : undefined;
  if (primPath !== undefined) return primPath;
  const raw = typeof object.name === "string" ? object.name.trim() : "";
  return raw.length > 0 ? raw : null;
}
