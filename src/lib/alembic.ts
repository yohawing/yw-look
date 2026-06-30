import { invoke } from "@tauri-apps/api/core";

export async function convertAlembicToPreview(
  path: string,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("convert_alembic_to_preview", { path });
}
