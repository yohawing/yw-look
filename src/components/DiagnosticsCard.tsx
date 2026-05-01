import type { DiagnosticsPayload } from "../lib/diagnostics";
import {
  SidebarEmpty,
  SidebarError,
  SidebarSection,
} from "./sidebarPrimitives";

type DiagnosticsCardProps = {
  diagnosticsPayload: DiagnosticsPayload | null;
  diagnosticsError: string | null;
};

export function DiagnosticsCard({
  diagnosticsPayload,
  diagnosticsError,
}: DiagnosticsCardProps) {
  if (diagnosticsError) {
    return (
      <SidebarSection title="Diagnostics">
        <SidebarError>{diagnosticsError}</SidebarError>
      </SidebarSection>
    );
  }

  if (!diagnosticsPayload) {
    return (
      <SidebarSection title="Diagnostics">
        <SidebarEmpty>Loading diagnostics log.</SidebarEmpty>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection
      title="Diagnostics"
      count={diagnosticsPayload.diagnosticsSnapshot.length}
    >
      <p className="sidebar-path">{diagnosticsPayload.diagnosticsLogPath}</p>
      {diagnosticsPayload.diagnosticsSnapshot.length > 0 ? (
        <pre className="log-preview">
          {diagnosticsPayload.diagnosticsSnapshot.join("\n")}
        </pre>
      ) : (
        <SidebarEmpty>No diagnostics events recorded yet.</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
