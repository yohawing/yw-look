import { invoke } from "@tauri-apps/api/core";
import type { AppError } from "../types/ipc";
import { normalizeErrorMessage } from "./errors";

export type InvokeResult<T> =
  { ok: true; value: T } | { ok: false; error: AppError };

export async function invokeSafe<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<InvokeResult<T>> {
  try {
    const value =
      args === undefined ? await invoke<T>(cmd) : await invoke<T>(cmd, args);
    return { ok: true, value };
  } catch (err: unknown) {
    return { ok: false, error: normalizeAppError(err) };
  }
}

function normalizeAppError(err: unknown): AppError {
  return normalizeErrorMessage(err);
}
