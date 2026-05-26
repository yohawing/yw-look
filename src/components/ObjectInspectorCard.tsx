import type { AssetMetadata, ObjectInfo } from "./assetMetadata";
import {
  SidebarEmpty,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

type ObjectInspectorCardProps = {
  selectedKey: string | null;
  objectInfo: ObjectInfo | null;
  metadata: AssetMetadata | null;
};

function fmt3(v: readonly number[]): string {
  return v.map((n) => n.toFixed(4)).join(", ");
}

export function ObjectInspectorCard({
  selectedKey,
  objectInfo,
  metadata,
}: ObjectInspectorCardProps) {
  if (!selectedKey || !objectInfo || !metadata) {
    return null;
  }

  const transformRows: SidebarKeyValueRow[] = [
    {
      id: "position",
      label: "Position",
      value: fmt3(objectInfo.position),
      mono: true,
    },
    {
      id: "rotation",
      label: "Rotation",
      value: `${fmt3(objectInfo.rotation)}°`,
      mono: true,
    },
    {
      id: "scale",
      label: "Scale",
      value: fmt3(objectInfo.scale),
      mono: true,
    },
  ];

  return (
    <SidebarSection title="Transform">
      <SidebarKeyValueRows rows={transformRows} />
    </SidebarSection>
  );
}

export function ObjectInspectorEmpty() {
  return (
    <SidebarSection title="Selected Object">
      <SidebarEmpty>
        Select an object in the viewport or outliner to inspect.
      </SidebarEmpty>
    </SidebarSection>
  );
}
