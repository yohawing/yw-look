import type { AppError } from "../types/ipc";

export function isStructuredErrorShape(
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
  if (isStructuredErrorShape(error)) return error.message;
  return fallback;
}

export function normalizeErrorMessage(error: unknown): AppError {
  if (isStructuredErrorShape(error)) {
    return {
      kind: error.kind as AppError["kind"],
      message: error.message,
    };
  }
  return { kind: "internal", message: errorMessage(error, "Unknown error") };
}
