import type { CameraEntry, LightEntry } from "./assetMetadata";
import type { UsdLightInfo } from "../lib/usd";
import {
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

type SceneLightsCamerasCardProps = {
  lights: LightEntry[];
  cameras: CameraEntry[];
  /** #35 — USD light details fetched via the C++ backend. When present,
   * a "USD Lights" section is rendered alongside (or instead of) the
   * Three.js-derived light list. `undefined` means the data has not
   * been fetched yet or is unavailable (Rust-fork backend). */
  usdLights?: UsdLightInfo[];
  /** Stable composite key (`CameraEntry.id`) of the USD camera currently
   * used as the active viewport camera. `null` means the default free-
   * orbit camera is active. The id is `cameraSelectionKey()` output —
   * authored display name for the first occurrence, suffixed `#1`, `#2`
   * for duplicates — which keeps duplicate-named cameras independently
   * selectable AND survives variant / load-policy reloads (Three.js
   * uuids would not). */
  activeCameraId?: string | null;
  /** Called when the user picks a USD camera (by selection key) or
   * clears the selection back to free orbit (`null`). */
  onSelectCamera?: (cameraId: string | null) => void;
};

function shortLightLabel(type: string): string {
  return type.replace(/Light$/, "");
}

function formatFov(fov: number | null): string {
  return fov === null ? "—" : `${fov.toFixed(1)}°`;
}

function formatAspect(aspect: number | null): string {
  return aspect === null ? "—" : aspect.toFixed(3);
}

/** Convert a linear [0,1] float to a 2-digit hex string. */
function linearToHex(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
}

/** Format a linearized RGB triple as a CSS hex color string. */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${linearToHex(r)}${linearToHex(g)}${linearToHex(b)}`;
}

export function SceneLightsCamerasCard({
  lights,
  cameras,
  usdLights,
  activeCameraId = null,
  onSelectCamera,
}: SceneLightsCamerasCardProps) {
  if (lights.length === 0 && cameras.length === 0 && !usdLights?.length) {
    return null;
  }

  const summaryRows: SidebarKeyValueRow[] = [
    {
      id: "lights",
      label: "Lights",
      value: usdLights ? usdLights.length : lights.length,
      mono: true,
    },
    { id: "cameras", label: "Cameras", value: cameras.length, mono: true },
  ];

  return (
    <>
      <SidebarSection title="Scene Fixtures">
        <SidebarKeyValueRows rows={summaryRows} />
      </SidebarSection>

      {/* #35 — USD Lights section (C++ backend only) */}
      {usdLights && usdLights.length > 0 && (
        <SidebarSection title="USD Lights" count={usdLights.length}>
          <ul className="scene-fixture-list">
            {usdLights.map((light) => {
              const hex = rgbToHex(
                light.color[0],
                light.color[1],
                light.color[2],
              );
              return (
                <li key={light.primPath} className="scene-fixture-item">
                  <strong className="scene-fixture-name">
                    {light.primPath}
                  </strong>
                  <span className="badge badge-ok scene-fixture-chip">
                    {shortLightLabel(light.lightKind)}
                  </span>
                  <span className="muted scene-fixture-detail">
                    intensity {light.intensity.toFixed(2)}
                  </span>
                  {light.exposure !== 0 && (
                    <>
                      {" "}
                      <span className="muted scene-fixture-detail">
                        exp {light.exposure > 0 ? "+" : ""}
                        {light.exposure.toFixed(2)}
                      </span>
                    </>
                  )}{" "}
                  <span
                    className="badge scene-fixture-chip"
                    style={{
                      backgroundColor: hex,
                      color: "#0e1116",
                      fontFamily: "monospace",
                    }}
                    title="inputs:color"
                  >
                    {hex}
                  </span>
                  {light.colorTemperature !== null && (
                    <>
                      {" "}
                      <span className="muted scene-fixture-detail">
                        {light.colorTemperature.toFixed(0)}K
                      </span>
                    </>
                  )}
                  {(light.specular !== 1 || light.diffuse !== 1) && (
                    <>
                      {" "}
                      <span className="muted scene-fixture-detail">
                        spec {light.specular.toFixed(2)} diff{" "}
                        {light.diffuse.toFixed(2)}
                      </span>
                    </>
                  )}
                  {light.domeTextureFile && (
                    <>
                      {" "}
                      <span
                        className="muted scene-fixture-detail"
                        title={light.domeTextureFile}
                        style={{ fontFamily: "monospace", fontSize: "0.85em" }}
                      >
                        {light.domeTextureFile.split(/[\\/]/).pop()}
                      </span>
                    </>
                  )}
                  {light.shapingCone && (
                    <>
                      {" "}
                      <span className="muted scene-fixture-detail">
                        cone {light.shapingCone.angle.toFixed(1)}°
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </SidebarSection>
      )}

      {/* Three.js-derived lights (shown when USD lights are unavailable) */}
      {!usdLights && lights.length > 0 && (
        <SidebarSection title="Lights" count={lights.length}>
          <ul className="scene-fixture-list">
            {lights.map((light) => (
              <li key={light.id} className="scene-fixture-item">
                <strong className="scene-fixture-name">{light.name}</strong>
                <span className="badge badge-ok scene-fixture-chip">
                  {shortLightLabel(light.type)}
                </span>
                <span className="muted scene-fixture-detail">
                  intensity {light.intensity.toFixed(2)}
                </span>
                {light.color && (
                  <>
                    {" "}
                    <span
                      className="badge scene-fixture-chip"
                      style={{
                        backgroundColor: light.color,
                        color: "#0e1116",
                        fontFamily: "monospace",
                      }}
                    >
                      {light.color}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </SidebarSection>
      )}

      {cameras.length > 0 && (
        <SidebarSection title="Cameras" count={cameras.length}>
          <ul className="scene-fixture-list">
            {onSelectCamera && (
              <li className="scene-fixture-item">
                <button
                  className={`badge scene-fixture-button${activeCameraId === null ? " badge-ok" : ""}`}
                  onClick={() => onSelectCamera(null)}
                  type="button"
                  title="Switch to free-orbit camera"
                  aria-pressed={activeCameraId === null}
                >
                  Free Orbit
                </button>
              </li>
            )}
            {cameras.map((camera) => {
              const isActive = activeCameraId === camera.id;
              return (
                <li
                  key={camera.id}
                  className="scene-fixture-item scene-fixture-item--camera"
                >
                  <div className="scene-fixture-title-row">
                    <strong className="scene-fixture-name">
                      {camera.name}
                    </strong>
                    <span className="badge badge-ok scene-fixture-chip">
                      {camera.projection}
                    </span>
                    {onSelectCamera && (
                      <button
                        className={`badge scene-fixture-button${isActive ? " badge-ok" : ""}`}
                        onClick={() =>
                          onSelectCamera(isActive ? null : camera.id)
                        }
                        type="button"
                        title={
                          isActive
                            ? "Reset to free orbit"
                            : `Use ${camera.name} as active camera`
                        }
                        aria-pressed={isActive}
                      >
                        {isActive ? "Active" : "View"}
                      </button>
                    )}
                  </div>
                  <span className="muted scene-fixture-detail scene-fixture-detail--full">
                    fov {formatFov(camera.fov)} · aspect{" "}
                    {formatAspect(camera.aspect)} · near{" "}
                    {camera.near.toFixed(3)} · far {camera.far.toFixed(1)}
                  </span>
                </li>
              );
            })}
          </ul>
        </SidebarSection>
      )}
    </>
  );
}
