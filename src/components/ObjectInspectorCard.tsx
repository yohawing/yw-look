import type { AssetMetadata, MaterialEntry, ObjectInfo } from "./assetMetadata";
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

function fmtBBox(
  bbox: [number, number, number, number, number, number],
): string {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bbox;
  const sx = (maxX - minX).toFixed(4);
  const sy = (maxY - minY).toFixed(4);
  const sz = (maxZ - minZ).toFixed(4);
  return `${sx} x ${sy} x ${sz}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function MaterialInline({ mat }: { mat: MaterialEntry }) {
  const color =
    mat.baseColorFactor !== null
      ? rgbToHex(
          mat.baseColorFactor[0],
          mat.baseColorFactor[1],
          mat.baseColorFactor[2],
        )
      : mat.color;

  return (
    <div className="oi-material-item">
      <span className="oi-material-header">
        {color && (
          <span className="mat-inline-swatch" style={{ background: color }} />
        )}
        <span className="oi-material-name">{mat.name}</span>
        <span className="oi-material-type">{mat.type}</span>
        {mat.alphaMode !== "OPAQUE" && mat.alphaMode !== "unknown" && (
          <span className="sidebar-chip">{mat.alphaMode}</span>
        )}
      </span>
      <div className="oi-material-details">
        {mat.baseColorFactor !== null && (
          <span className="oi-material-detail">
            <span
              className="mat-inline-swatch"
              style={{
                background: rgbToHex(
                  mat.baseColorFactor[0],
                  mat.baseColorFactor[1],
                  mat.baseColorFactor[2],
                ),
              }}
            />
            {rgbToHex(
              mat.baseColorFactor[0],
              mat.baseColorFactor[1],
              mat.baseColorFactor[2],
            )}
            {mat.baseColorFactor[3] < 1 && (
              <span className="mat-slot-alpha">
                {" "}
                a:{Math.round(mat.baseColorFactor[3] * 255)}
              </span>
            )}
          </span>
        )}
        {mat.metallicFactor !== null && (
          <span className="oi-material-detail">
            M:{mat.metallicFactor.toFixed(2)}
          </span>
        )}
        {mat.roughnessFactor !== null && (
          <span className="oi-material-detail">
            R:{mat.roughnessFactor.toFixed(2)}
          </span>
        )}
        {mat.textureCount > 0 && (
          <span className="oi-material-detail">Tex:{mat.textureCount}</span>
        )}
      </div>
    </div>
  );
}

function formatUserDataValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ObjectInspectorCard({
  selectedKey,
  objectInfo,
  metadata,
}: ObjectInspectorCardProps) {
  if (!selectedKey || !objectInfo || !metadata) {
    return null;
  }

  const objectRows: SidebarKeyValueRow[] = [
    { id: "name", label: "Name", value: objectInfo.name, mono: true },
    { id: "type", label: "Type", value: objectInfo.kind, tone: "muted" },
    {
      id: "visible",
      label: "Visible",
      value: objectInfo.visible ? "Yes" : "No",
      tone: objectInfo.visible ? "ok" : "muted",
    },
  ];

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

  const boundsRows: SidebarKeyValueRow[] = [];
  if (objectInfo.boundingBox) {
    boundsRows.push({
      id: "size",
      label: "Size",
      value: fmtBBox(objectInfo.boundingBox),
      mono: true,
    });
    boundsRows.push({
      id: "min",
      label: "Min",
      value: fmt3(objectInfo.boundingBox.slice(0, 3)),
      mono: true,
      tone: "muted",
    });
    boundsRows.push({
      id: "max",
      label: "Max",
      value: fmt3(objectInfo.boundingBox.slice(3)),
      mono: true,
      tone: "muted",
    });
  }

  const geometryRows: SidebarKeyValueRow[] = [];
  if (objectInfo.vertexCount !== null) {
    geometryRows.push({
      id: "vertices",
      label: "Vertices",
      value: objectInfo.vertexCount.toLocaleString(),
      mono: true,
    });
  }
  if (objectInfo.triangleCount !== null) {
    geometryRows.push({
      id: "triangles",
      label: "Triangles",
      value: objectInfo.triangleCount.toLocaleString(),
      mono: true,
    });
  }

  if (objectInfo.childCount !== null) {
    geometryRows.push({
      id: "children",
      label: "Children",
      value: objectInfo.childCount,
      mono: true,
    });
  }

  const assignedMaterials = objectInfo.materialIds
    .map((id) => metadata.materials.find((m) => m.id === id))
    .filter((m): m is MaterialEntry => !!m);

  const animRows: SidebarKeyValueRow[] = [];
  if (objectInfo.animatesWithClips.length > 0) {
    animRows.push({
      id: "clips",
      label: "Clips",
      value: objectInfo.animatesWithClips.join(", "),
      mono: true,
    });
  }

  const userDataRows: SidebarKeyValueRow[] = [];
  if (objectInfo.userData) {
    for (const [key, value] of Object.entries(objectInfo.userData)) {
      userDataRows.push({
        id: `ud-${key}`,
        label: key,
        value: formatUserDataValue(value),
        mono: true,
        tone: "muted",
      });
    }
  }

  return (
    <>
      <SidebarSection title="Selected Object">
        <SidebarKeyValueRows rows={objectRows} />
      </SidebarSection>
      <SidebarSection title="Transform">
        <SidebarKeyValueRows rows={transformRows} />
      </SidebarSection>
      {boundsRows.length > 0 && (
        <SidebarSection title="Bounding Box">
          <SidebarKeyValueRows rows={boundsRows} />
        </SidebarSection>
      )}
      {geometryRows.length > 0 && (
        <SidebarSection title="Geometry">
          <SidebarKeyValueRows rows={geometryRows} />
        </SidebarSection>
      )}
      {assignedMaterials.length > 0 && (
        <SidebarSection title="Materials" count={assignedMaterials.length}>
          <div className="oi-material-list">
            {assignedMaterials.map((mat) => (
              <MaterialInline key={mat.id} mat={mat} />
            ))}
          </div>
        </SidebarSection>
      )}
      {animRows.length > 0 && (
        <SidebarSection title="Animation">
          <SidebarKeyValueRows rows={animRows} />
        </SidebarSection>
      )}
      {userDataRows.length > 0 && (
        <SidebarSection title="User Data">
          <SidebarKeyValueRows rows={userDataRows} />
        </SidebarSection>
      )}
    </>
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
