import { t, useLocale } from "../lib/i18n";
import { useState } from "react";
import { openAppLogDir } from "../lib/diagnostics";
import type { CrashRecoveryPayload } from "../lib/crashRecovery";
import "../styles/sidebar.css";

type CrashRecoveryNoticeProps = {
  status: CrashRecoveryPayload | null;
};

export function CrashRecoveryNotice({ status }: CrashRecoveryNoticeProps) {
  useLocale();
  const [dismissed, setDismissed] = useState(false);

  if (!status?.previousCrashDetected || dismissed) {
    return null;
  }

  const detail =
    status.previousPid !== null
      ? `PID ${status.previousPid}`
      : t("crash.previousSession");

  return (
    <section className="crash-recovery-notice" role="alert">
      <div>
        <h2>{t("previous_session_ended_unexpectedly")}</h2>
        <p>{t("crash.detail", { session: detail })}</p>
      </div>
      <div className="crash-recovery-notice__actions">
        <button type="button" onClick={() => void openAppLogDir()}>
          {t("open_logs")}
        </button>
        <button type="button" onClick={() => setDismissed(true)}>
          {t("dismiss")}
        </button>
      </div>
    </section>
  );
}
