import type { MaterialEntry, MaterialTextureSlot } from "./assetMetadata";

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
                <span className="card-row-badge">{mat.alphaMode}</span>
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

export function MaterialListCard({ materials }: MaterialListCardProps) {
  return (
    <article className="card">
      <p className="card-title">Materials</p>
      {materials.length > 0 ? (
        <ul className="material-list">
          {materials.map((mat) => (
            <li key={mat.id} className="material-item">
              <div className="material-swatch-wrap">
                {mat.color ? (
                  <span
                    className="material-swatch"
                    style={{ background: mat.color }}
                  />
                ) : (
                  <span className="material-swatch material-swatch-none" />
                )}
              </div>
              <div className="material-info">
                <span className="material-name">{mat.name}</span>
                <span className="material-meta">
                  <span className="card-row-badge">{mat.type}</span>
                  {mat.textureCount > 0 ? (
                    <span className="material-detail">
                      {mat.textureCount} tex
                    </span>
                  ) : null}
                  {mat.transparent ? (
                    <span className="material-detail">
                      a:{mat.opacity.toFixed(2)}
                    </span>
                  ) : null}
                  {mat.boundMeshes.length > 0 ? (
                    <span
                      className="material-detail"
                      title={mat.boundMeshes.join("\n")}
                    >
                      {mat.boundMeshes.length} bind
                      {mat.boundMeshes.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </span>
                {mat.boundMeshes.length > 0 && (
                  <details className="material-bindings">
                    <summary className="material-detail">bound meshes</summary>
                    <ul className="material-bindings-list">
                      {mat.boundMeshes.map((meshName, index) => (
                        <li
                          key={`${meshName}:${index}`}
                          className="material-binding"
                        >
                          {meshName}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <ShaderDetails mat={mat} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-empty">No materials found.</p>
      )}
    </article>
  );
}
