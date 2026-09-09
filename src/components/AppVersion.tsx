import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { version as packageVersion } from "../../package.json";
import { isTauriEnvironment } from "../lib/platform";

export function AppVersion() {
  const [version, setVersion] = useState(packageVersion);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let active = true;
    void getVersion()
      .then((runtimeVersion) => {
        if (active && runtimeVersion.trim()) setVersion(runtimeVersion);
      })
      .catch(() => {
        // The embedded package version remains useful if native IPC is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  return <span className="app-version">yw-look v{version}</span>;
}
