import { rgbToHex } from "../lib/format";
import type { UsdLightInfo } from "../lib/usd";
import type { CameraEntry, LightEntry } from "./assetMetadata";
import {
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "../lib/sidebarPrimitives";
import { Badge, BadgeButton } from "./ui/Badge";

type SceneLightsCamerasCardProps = {
  lights: LightEntry[];
  cameras: CameraEntry[];
  /** #35 — USD light details fetched via a USD backend. When present,
   * a "USD Lights" section is rendered alongside (or instead of) the
   * Three.js-derived light list. `undefined` means the data has not
   * been fetched yet or is unavailable. */
  usdLights?: UsdLightInfo[];
  usdLightsError?: string | null;
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

export function SceneLightsCamerasCard({
  lights,
  cameras,
  usdLights,
  usdLightsError = null,
  activeCameraId = null,
  onSelectCamera,
}: SceneLightsCamerasCardProps) {
  if (
    lights.length === 0 &&
    cameras.length === 0 &&
    !usdLights?.length &&
    !usdLightsError
  ) {
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
    <SidebarSection title="Scene" collapsible defaultOpen={false}>
      <SidebarKeyValueRows rows={summaryRows} />
      {usdLightsError ? <SidebarError>{usdLightsError}</SidebarError> : null}

      {/* #35 — USD Lights section when the backend provides details. */}
      {usdLights && usdLights.length > 0 && (
        <SidebarSection
          title="USD Lights"
          count={usdLights.length}
          collapsible
          defaultOpen={false}
        >
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
                  <Badge
                    className="scene-fixture-badge"
                    variant="success"
                    size="sm"
                  >
                    {shortLightLabel(light.lightKind)}
                  </Badge>
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
                  <Badge
                    className="scene-fixture-badge"
                    mono
                    size="sm"
                    style={{
                      backgroundColor: hex,
                      color: "#0e1116",
                    }}
                  >
                    {hex}
                  </Badge>
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
        <SidebarSection
          title="Lights"
          count={lights.length}
          collapsible
          defaultOpen={false}
        >
          <ul className="scene-fixture-list">
            {lights.map((light) => (
              <li key={light.id} className="scene-fixture-item">
                <strong className="scene-fixture-name">{light.name}</strong>
                <Badge
                  className="scene-fixture-badge"
                  variant="success"
                  size="sm"
                >
                  {shortLightLabel(light.type)}
                </Badge>
                <span className="muted scene-fixture-detail">
                  intensity {light.intensity.toFixed(2)}
                </span>
                {light.color && (
                  <>
                    {" "}
                    <Badge
                      className="scene-fixture-badge"
                      mono
                      size="sm"
                      style={{
                        backgroundColor: light.color,
                        color: "#0e1116",
                      }}
                    >
                      {light.color}
                    </Badge>
                  </>
                )}
              </li>
            ))}
          </ul>
        </SidebarSection>
      )}

      {cameras.length > 0 && (
        <SidebarSection
          title="Cameras"
          count={cameras.length}
          collapsible
          defaultOpen={false}
        >
          <ul className="scene-fixture-list">
            {onSelectCamera && (
              <li className="scene-fixture-item">
                <BadgeButton
                  className="scene-fixture-button"
                  variant={activeCameraId === null ? "success" : "neutral"}
                  size="sm"
                  onClick={() => onSelectCamera(null)}
                  aria-pressed={activeCameraId === null}
                >
                  Free Orbit
                </BadgeButton>
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
                    <Badge
                      className="scene-fixture-badge"
                      variant="success"
                      size="sm"
                    >
                      {camera.projection}
                    </Badge>
                    {onSelectCamera && (
                      <BadgeButton
                        className="scene-fixture-button"
                        variant={isActive ? "success" : "neutral"}
                        size="sm"
                        onClick={() =>
                          onSelectCamera(isActive ? null : camera.id)
                        }
                        aria-pressed={isActive}
                      >
                        {isActive ? "Active" : "View"}
                      </BadgeButton>
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
    </SidebarSection>
  );
}
