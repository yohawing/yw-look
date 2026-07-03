import type { IntegrationPayload } from "../lib/integrations";
import {
  AsyncSidebarSection,
  SidebarKeyValueRows,
  type SidebarKeyValueRow,
} from "../lib/sidebarPrimitives";
import { Badge } from "./ui/Badge";

type IntegrationCardProps = {
  integrationPayload: IntegrationPayload | null;
  integrationError: string | null;
};

export function IntegrationCard({
  integrationPayload,
  integrationError,
}: IntegrationCardProps) {
  return (
    <AsyncSidebarSection
      title="Windows Integration"
      error={integrationError}
      data={integrationPayload}
      loadingLabel="Loading Windows integration details."
    >
      {(payload) => {
        const rows: SidebarKeyValueRow[] = [
          {
            id: "strategy",
            label: "Install strategy",
            value: payload.installStrategy,
            tone: "muted",
          },
          {
            id: "associations",
            label: "File associations",
            value: payload.fileAssociationsEnabled ? "Enabled" : "Disabled",
            tone: payload.fileAssociationsEnabled ? "ok" : "muted",
          },
        ];

        return (
          <>
            <SidebarKeyValueRows rows={rows} />
            <div className="sidebar-badge-row">
              {payload.supportedExtensions.map((ext) => (
                <Badge key={ext} mono size="sm">
                  {ext}
                </Badge>
              ))}
            </div>
          </>
        );
      }}
    </AsyncSidebarSection>
  );
}
