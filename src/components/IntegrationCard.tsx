import type { IntegrationPayload } from "../lib/integrations";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

type IntegrationCardProps = {
  integrationPayload: IntegrationPayload | null;
  integrationError: string | null;
};

export function IntegrationCard({
  integrationPayload,
  integrationError,
}: IntegrationCardProps) {
  if (integrationError) {
    return (
      <SidebarSection title="Windows Integration">
        <SidebarError>{integrationError}</SidebarError>
      </SidebarSection>
    );
  }

  if (!integrationPayload) {
    return (
      <SidebarSection title="Windows Integration">
        <SidebarEmpty>Loading Windows integration details.</SidebarEmpty>
      </SidebarSection>
    );
  }

  const rows: SidebarKeyValueRow[] = [
    {
      id: "strategy",
      label: "Install strategy",
      value: integrationPayload.installStrategy,
      tone: "muted",
    },
    {
      id: "associations",
      label: "File associations",
      value: integrationPayload.fileAssociationsEnabled
        ? "Enabled"
        : "Disabled",
      tone: integrationPayload.fileAssociationsEnabled ? "ok" : "muted",
    },
  ];

  return (
    <SidebarSection title="Windows Integration">
      <SidebarKeyValueRows rows={rows} />
      <div className="sidebar-chip-row">
        {integrationPayload.supportedExtensions.map((ext) => (
          <span key={ext} className="sidebar-chip is-mono">
            {ext}
          </span>
        ))}
      </div>
    </SidebarSection>
  );
}
