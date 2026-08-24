import { invoke } from "@tauri-apps/api/core";

export function convertFbxToPreview(
  path: string,
  requestId: string,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("convert_fbx_to_preview", { path, requestId });
}

export function cancelFbxImport(requestId: string): Promise<boolean> {
  return invoke<boolean>("cancel_fbx_import", { requestId });
}
