import { useState } from "react";
import type { MaterialEntry, MaterialTextureSlot } from "./assetMetadata";
import { SidebarEmpty, SidebarSection } from "./sidebarPrimitives";

type MaterialListCardProps = {
  materials: MaterialEntry[];
};

/** Format a 0-1 float as a 0-255 decimal integer string for display. */
function fmt255(v: number): string {
  return String(Math.round(v * 255));
}

/** Convert linear-float RGB to a CSS hex string (#rrggbb). */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
    <details className="material-bindings material-shader-details">
      <summary className="material-detail">shader inputs</summary>
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
                <span className="sidebar-chip">{mat.alphaMode}</span>
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
    </details>
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
          {color.toUpperCase()}
        </>
      ) : (
        "unknown"
      )}
    </span>
  );
}

function MaterialDetailPanel({ mat }: { mat: MaterialEntry }) {
  return (
    <section className="material-selected-panel" aria-label="Selected material">
      <p className="material-selected-title">Selected material</p>
      <dl className="material-detail-grid">
        <div className="material-detail-row">
          <dt>Shader</dt>
          <dd>{mat.type}</dd>
        </div>
        <div className="material-detail-row">
          <dt>Base color</dt>
          <dd>
            <MaterialBaseColor mat={mat} />
          </dd>
        </div>
        {mat.metallicFactor !== null && (
          <div className="material-detail-row">
            <dt>Metallic</dt>
            <dd>{mat.metallicFactor.toFixed(2)}</dd>
          </div>
        )}
        {mat.roughnessFactor !== null && (
          <div className="material-detail-row">
            <dt>Roughness</dt>
            <dd>{mat.roughnessFactor.toFixed(2)}</dd>
          </div>
        )}
        <div className="material-detail-row">
          <dt>Alpha mode</dt>
          <dd className={mat.alphaMode === "OPAQUE" ? "muted-value" : ""}>
            {mat.alphaMode}
          </dd>
        </div>
        <div className="material-detail-row">
          <dt>Opacity</dt>
          <dd>{mat.opacity.toFixed(2)}</dd>
        </div>
        <div className="material-detail-row">
          <dt>Textures</dt>
          <dd>{mat.textureCount}</dd>
        </div>
        <div className="material-detail-row">
          <dt>Bindings</dt>
          <dd>{mat.boundMeshes.length}</dd>
        </div>
      </dl>
      {mat.boundMeshes.length > 0 && (
        <details className="material-bindings">
          <summary className="material-detail">bound meshes</summary>
          <ul className="material-bindings-list">
            {mat.boundMeshes.map((meshName, index) => (
              <li key={`${meshName}:${index}`} className="material-binding">
                {meshName}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ShaderDetails mat={mat} />
    </section>
  );
}

export function MaterialListCard({ materials }: MaterialListCardProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex =
    materials.length > 0 ? Math.min(selectedIndex, materials.length - 1) : -1;
  const selectedMaterial = activeIndex >= 0 ? materials[activeIndex] : null;

  return (
    <SidebarSection title="Materials" count={materials.length}>
      {materials.length > 0 ? (
        <>
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
                      {mat.transparent ? ` · a:${mat.opacity.toFixed(2)}` : ""}
                      {mat.boundMeshes.length > 0
                        ? ` · ${mat.boundMeshes.length} bind${mat.boundMeshes.length === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  </span>
                  <span className="material-count-pill">
                    {mat.textureCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selectedMaterial && <MaterialDetailPanel mat={selectedMaterial} />}
        </>
      ) : (
        <SidebarEmpty>No materials found.</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
