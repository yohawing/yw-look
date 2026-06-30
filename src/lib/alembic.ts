import { invoke } from "@tauri-apps/api/core";

export async function convertAlembicToPreview(
  path: string,
): Promise<ArrayBuffer | string> {
  return invoke<ArrayBuffer | string>("convert_alembic_to_preview", { path });
}
