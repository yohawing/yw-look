import { useState } from "react";
import { openAppLogDir } from "../lib/diagnostics";
import type { CrashRecoveryPayload } from "../lib/crashRecovery";
import "../styles/sidebar.css";

type CrashRecoveryNoticeProps = {
  status: CrashRecoveryPayload | null;
};

export function CrashRecoveryNotice({ status }: CrashRecoveryNoticeProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!status?.previousCrashDetected || dismissed) {
    return null;
  }

  const detail =
    status.previousPid !== null
      ? `PID ${status.previousPid}`
      : "previous session";

  return (
    <section className="crash-recovery-notice" role="alert">
      <div>
        <h2>Previous Session Ended Unexpectedly</h2>
        <p>
          yw-look found an uncleared run marker from {detail}. Review the logs
          before retrying the same asset.
        </p>
      </div>
      <div className="crash-recovery-notice__actions">
        <button type="button" onClick={() => void openAppLogDir()}>
          Open Logs
        </button>
        <button type="button" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
