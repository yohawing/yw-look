import { useState } from "react";
import type { ReactNode } from "react";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { rgbToHex } from "../lib/format";
import { useFileStore } from "../stores/fileStore";
import type {
  MaterialEntry,
  MaterialTextureSlot,
  MmdMaterialEntry,
} from "./assetMetadata";
import { SidebarEmpty, SidebarSection } from "../lib/sidebarPrimitives";
import { Badge } from "./ui/Badge";
import { Disclosure } from "./ui/Disclosure";
import { KeyValueRows, type KeyValueRow } from "./ui/KeyValueRows";
import "../styles/material-list.css";

type MaterialListCardProps = {
  debugPanelsEnabled?: boolean;
};

const EMPTY_MATERIALS: MaterialEntry[] = [];

/** Format a 0-1 float as a 0-255 decimal integer string for display. */
function fmt255(v: number): string {
  return String(Math.round(v * 255));
}

function fmtFloat(v: number): string {
  return v.toFixed(3).replace(/\.?0+$/, "");
}

function fmtVec(values: readonly number[]): string {
  return values.map(fmtFloat).join(", ");
}

function fmtTexturePath(path: string | null): string {
  return path ?? "none";
}

function fmtFlags(flags: Record<string, boolean> | null): string {
  if (!flags) return "none";
  const enabled = Object.entries(flags)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  return enabled.length > 0 ? enabled.join(", ") : "none";
}

function TextureSlotRow({
  label,
  slot,
}: {
  label: string;
  slot: MaterialTextureSlot | null;
}) {
  if (!slot) return null;
  return (
    <tr className="mat-slot-row">
      <td className="mat-slot-label">{label}</td>
      <td className="mat-slot-value mat-slot-texture">{slot.name}</td>
    </tr>
  );
}

function MmdValueRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <tr className="mat-slot-row">
      <td className="mat-slot-label">{label}</td>
      <td className="mat-slot-value">{children}</td>
    </tr>
  );
}

function MmdColorRow({
  label,
  value,
}: {
  label: string;
  value: [number, number, number] | [number, number, number, number] | null;
}) {
  if (!value) return null;
  return (
    <MmdValueRow label={label}>
      <span
        className="mat-inline-swatch"
        style={{ background: rgbToHex(value[0], value[1], value[2]) }}
      />
      <span className="mat-slot-hex">
        {rgbToHex(value[0], value[1], value[2])}
      </span>
      <span className="mat-slot-alpha"> ({fmtVec(value)})</span>
    </MmdValueRow>
  );
}

function MmdMaterialDetails({ mmd }: { mmd: MmdMaterialEntry | null }) {
  if (!mmd) return null;
  return (
    <Disclosure variant="inline" title="MMD material" defaultOpen>
      <table className="mat-slot-table">
        <tbody>
          {mmd.materialIndex !== null && (
            <MmdValueRow label="Index">{mmd.materialIndex}</MmdValueRow>
          )}
          {mmd.englishName && mmd.englishName !== mmd.name && (
            <MmdValueRow label="English">{mmd.englishName}</MmdValueRow>
          )}
          <MmdColorRow label="Diffuse" value={mmd.diffuse} />
          <MmdColorRow label="Specular" value={mmd.specular} />
          {mmd.specularPower !== null && (
            <MmdValueRow label="Spec Power">
              {fmtFloat(mmd.specularPower)}
            </MmdValueRow>
          )}
          <MmdColorRow label="Ambient" value={mmd.ambient} />
          <MmdColorRow label="Edge" value={mmd.edgeColor} />
          {mmd.edgeSize !== null && (
            <MmdValueRow label="Edge Size">
              {fmtFloat(mmd.edgeSize)}
            </MmdValueRow>
          )}
          <MmdValueRow label="Texture">
            <span className="mat-slot-texture">
              {fmtTexturePath(mmd.texturePath)}
            </span>
          </MmdValueRow>
          <MmdValueRow label="Sphere">
            <span className="mat-slot-texture">
              {fmtTexturePath(mmd.sphereTexturePath)}
            </span>
            {mmd.sphereMode && (
              <span className="mat-slot-alpha"> ({mmd.sphereMode})</span>
            )}
          </MmdValueRow>
          <MmdValueRow label="Toon">
            <span className="mat-slot-texture">
              {fmtTexturePath(mmd.toonTexturePath)}
            </span>
            {mmd.sharedToonIndex !== null && (
              <span className="mat-slot-alpha">
                {" "}
                shared:{mmd.sharedToonIndex}
              </span>
            )}
          </MmdValueRow>
          {mmd.transparencyMode && (
            <MmdValueRow label="Transparency">
              <Badge size="sm">{mmd.transparencyMode}</Badge>
            </MmdValueRow>
          )}
          {mmd.renderOrderBucket && (
            <MmdValueRow label="Render Order">
              {mmd.renderOrderBucket}
            </MmdValueRow>
          )}
          {mmd.faceCount !== null && (
            <MmdValueRow label="Faces">{mmd.faceCount}</MmdValueRow>
          )}
          <MmdValueRow label="Flags">{fmtFlags(mmd.flags)}</MmdValueRow>
          {mmd.unsupportedDrawFlags.length > 0 && (
            <MmdValueRow label="Unsupported">
              {mmd.unsupportedDrawFlags.join(", ")}
            </MmdValueRow>
          )}
        </tbody>
      </table>
    </Disclosure>
  );
}

function ShaderDetails({ mat }: { mat: MaterialEntry }) {
  const hasAnyDetail =
    mat.baseColorFactor !== null ||
    mat.metallicFactor !== null ||
    mat.roughnessFactor !== null ||
    mat.emissiveFactor !== null ||
    mat.baseColorTexture !== null ||
    mat.metallicRoughnessTexture !== null ||
    mat.normalTexture !== null ||
    mat.emissiveTexture !== null ||
    mat.usdPrimPath !== null;

  if (!hasAnyDetail) return null;

  return (
    <Disclosure variant="inline" title="shader inputs" defaultOpen={false}>
      <table className="mat-slot-table">
        <tbody>
          {mat.baseColorFactor !== null && (
            <tr className="mat-slot-row">
              <td className="mat-slot-label">Base Color</td>
              <td className="mat-slot-value">
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
                <span className="mat-slot-hex">
                  {rgbToHex(
                    mat.baseColorFactor[0],
                    mat.baseColorFactor[1],
                    mat.baseColorFactor[2],
                  )}
                </span>
                {mat.baseColorFactor[3] < 1 && (
                  <span className="mat-slot-alpha">
                    {" "}
                    a:{fmt255(mat.baseColorFactor[3])}
                  </span>
                )}
              </td>
            </tr>
          )}
          {mat.metallicFactor !== null && (
            <tr className="mat-slot-row">
              <td className="mat-slot-label">Metallic</td>
              <td className="mat-slot-value">
                {mat.metallicFactor.toFixed(3)}
              </td>
            </tr>
          )}
          {mat.roughnessFactor !== null && (
            <tr className="mat-slot-row">
              <td className="mat-slot-label">Roughness</td>
              <td className="mat-slot-value">
                {mat.roughnessFactor.toFixed(3)}
              </td>
            </tr>
          )}
          {mat.emissiveFactor !== null &&
            (mat.emissiveFactor[0] > 0 ||
              mat.emissiveFactor[1] > 0 ||
              mat.emissiveFactor[2] > 0) && (
              <tr className="mat-slot-row">
                <td className="mat-slot-label">Emissive</td>
                <td className="mat-slot-value">
                  <span
                    className="mat-inline-swatch"
                    style={{
                      background: rgbToHex(
                        mat.emissiveFactor[0],
                        mat.emissiveFactor[1],
                        mat.emissiveFactor[2],
                      ),
                    }}
                  />
                  <span className="mat-slot-hex">
                    {rgbToHex(
                      mat.emissiveFactor[0],
                      mat.emissiveFactor[1],
                      mat.emissiveFactor[2],
                    )}
                  </span>
                </td>
              </tr>
            )}
          <TextureSlotRow label="Color Tex" slot={mat.baseColorTexture} />
          <TextureSlotRow
            label="Metal/Rough Tex"
            slot={mat.metallicRoughnessTexture}
          />
          <TextureSlotRow label="Normal Tex" slot={mat.normalTexture} />
          <TextureSlotRow label="Emissive Tex" slot={mat.emissiveTexture} />
          {mat.alphaMode !== "OPAQUE" && mat.alphaMode !== "unknown" && (
            <tr className="mat-slot-row">
              <td className="mat-slot-label">Alpha</td>
              <td className="mat-slot-value">
                <Badge size="sm">{mat.alphaMode}</Badge>
              </td>
            </tr>
          )}
          {mat.usdPrimPath !== null && (
            <tr className="mat-slot-row">
              <td className="mat-slot-label">USD Path</td>
              <td className="mat-slot-value mat-slot-prim-path">
                {mat.usdPrimPath}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Disclosure>
  );
}

function MaterialBaseColor({ mat }: { mat: MaterialEntry }) {
  const color =
    mat.baseColorFactor !== null
      ? rgbToHex(
          mat.baseColorFactor[0],
          mat.baseColorFactor[1],
          mat.baseColorFactor[2],
        )
      : mat.color;

  return (
    <span className="material-detail-value material-detail-color">
      {color ? (
        <>
          <span className="mat-inline-swatch" style={{ background: color }} />
          {color}
        </>
      ) : (
        "unknown"
      )}
    </span>
  );
}

function MaterialDetailPanel({ mat }: { mat: MaterialEntry }) {
  const rows: KeyValueRow[] = [
    { id: "shader", label: "Shader", value: mat.type },
    {
      id: "base-color",
      label: "Base color",
      value: <MaterialBaseColor mat={mat} />,
    },
    mat.metallicFactor !== null && {
      id: "metallic",
      label: "Metallic",
      value: mat.metallicFactor.toFixed(2),
      mono: true,
    },
    mat.roughnessFactor !== null && {
      id: "roughness",
      label: "Roughness",
      value: mat.roughnessFactor.toFixed(2),
      mono: true,
    },
    {
      id: "alpha-mode",
      label: "Alpha mode",
      value: mat.alphaMode,
      tone: mat.alphaMode === "OPAQUE" ? "muted" : "default",
      mono: true,
    },
    {
      id: "opacity",
      label: "Opacity",
      value: mat.opacity.toFixed(2),
      mono: true,
    },
    {
      id: "textures",
      label: "Textures",
      value: mat.textureCount,
      mono: true,
    },
    {
      id: "bindings",
      label: "Bindings",
      value: mat.boundMeshes.length,
      mono: true,
    },
  ].filter(Boolean) as KeyValueRow[];

  return (
    <section className="material-selected-panel" aria-label="Selected material">
      <p className="material-selected-title">Selected material</p>
      <KeyValueRows
        className="material-detail-grid"
        density="regular"
        rows={rows}
      />
      {mat.boundMeshes.length > 0 && (
        <Disclosure
          variant="inline"
          title="bound meshes"
          count={mat.boundMeshes.length}
          defaultOpen={false}
        >
          <ul className="material-bindings-list">
            {mat.boundMeshes.map((meshName, index) => (
              <li key={`${meshName}:${index}`} className="material-binding">
                {meshName}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <MmdMaterialDetails mmd={mat.mmd} />
      <ShaderDetails mat={mat} />
    </section>
  );
}

export function MaterialListCard({
  debugPanelsEnabled = false,
}: MaterialListCardProps) {
  const storeMaterials = useFileStore(
    (state) => state.assetMetadata?.materials,
  );
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const materials = useDebugFixtures
    ? debugFixtures.debugPanelMetadata.materials
    : (storeMaterials ?? EMPTY_MATERIALS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex =
    materials.length > 0 ? Math.min(selectedIndex, materials.length - 1) : -1;
  const selectedMaterial = activeIndex >= 0 ? materials[activeIndex] : null;

  return (
    <SidebarSection title="Materials" count={materials.length}>
      {materials.length > 0 ? (
        <PanelGroup className="material-split-panel" orientation="vertical">
          <Panel
            className="material-list-pane"
            defaultSize={58}
            id="material-list"
            minSize={24}
          >
            <ul className="material-list">
              {materials.map((mat, index) => (
                <li key={mat.id} className="material-item">
                  <button
                    className={`material-row${index === activeIndex ? " is-selected" : ""}`}
                    onClick={() => setSelectedIndex(index)}
                    type="button"
                  >
                    <span
                      className={`material-swatch${mat.color ? "" : " material-swatch-none"}`}
                      style={mat.color ? { background: mat.color } : undefined}
                    />
                    <span className="material-info">
                      <span className="material-name">{mat.name}</span>
                      <span className="material-meta">
                        {mat.type} · {mat.textureCount} tex
                        {mat.transparent
                          ? ` · a:${mat.opacity.toFixed(2)}`
                          : ""}
                        {mat.boundMeshes.length > 0
                          ? ` · ${mat.boundMeshes.length} bind${mat.boundMeshes.length === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </span>
                    <Badge className="material-count-badge" mono size="sm">
                      {mat.textureCount}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <PanelResizeHandle
            className="material-resize-handle"
            aria-label="Resize material details"
          />
          <Panel
            className="material-detail-pane"
            defaultSize={42}
            id="material-detail"
            minSize={22}
          >
            {selectedMaterial && <MaterialDetailPanel mat={selectedMaterial} />}
          </Panel>
        </PanelGroup>
      ) : (
        <SidebarEmpty>No materials found.</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
