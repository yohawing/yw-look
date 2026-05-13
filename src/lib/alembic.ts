import { invoke } from "@tauri-apps/api/core";

export async function convertAlembicToPreview(path: string): Promise<string> {
  return invoke<string>("convert_alembic_to_preview", { path });
}
