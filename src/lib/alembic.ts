import { invoke } from "@tauri-apps/api/core";

export async function convertAlembicToObj(path: string): Promise<string> {
  return invoke<string>("convert_alembic_to_obj", { path });
}
