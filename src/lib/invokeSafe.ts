import { invoke } from "@tauri-apps/api/core";
import type { AppError } from "../types/ipc";

export type InvokeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export async function invokeSafe<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<InvokeResult<T>> {
  try {
    const value = await invoke<T>(cmd, args);
    return { ok: true, value };
  } catch (err: unknown) {
    return { ok: false, error: normalizeAppError(err) };
  }
}

function normalizeAppError(err: unknown): AppError {
  if (isAppErrorShape(err)) {
    return {
      kind: err.kind,
      message: err.message,
    };
  }

  const message =
    typeof err === "string" && err.trim()
      ? err
      : err instanceof Error
        ? err.message
        : "Unknown error";

  return { kind: "internal", message };
}

function isAppErrorShape(
  value: unknown,
): value is { kind: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as Record<string, unknown>).kind === "string" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
