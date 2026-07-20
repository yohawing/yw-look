import { invokeSafe } from "./invokeSafe";
import { isTauriEnvironment } from "./platform";
import type { CrashRecoveryPayload } from "../types/ipc";

export type { CrashRecoveryPayload };

export async function loadCrashRecoveryStatus(): Promise<CrashRecoveryPayload | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  const result = await invokeSafe<CrashRecoveryPayload>(
    "load_crash_recovery_status",
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
