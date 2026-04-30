import type { CameraEntry, LightEntry } from "./assetMetadata";

type SceneLightsCamerasCardProps = {
  lights: LightEntry[];
  cameras: CameraEntry[];
  /** Name of the USD camera currently used as the active viewport camera.
   * `null` means the default free-orbit camera is active. */
  activeCameraName?: string | null;
  /** Called when the user picks a USD camera (by name) or clears the
   * selection back to free orbit (`null`). */
  onSelectCamera?: (name: string | null) => void;
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
  activeCameraName = null,
  onSelectCamera,
}: SceneLightsCamerasCardProps) {
  if (lights.length === 0 && cameras.length === 0) {
    return null;
  }

  return (
    <article className="card">
      <p className="card-title">Scene Fixtures</p>
      <dl className="card-grid">
        <dt>Lights</dt>
        <dd>{lights.length}</dd>
        <dt>Cameras</dt>
        <dd>{cameras.length}</dd>
      </dl>
      {lights.length > 0 && (
        <details className="card-details" open>
          <summary className="card-path">
            Lights <span className="muted">({lights.length})</span>
          </summary>
          <ul className="card-list">
            {lights.map((light) => (
              <li key={light.id} className="issue">
                <strong>{light.name}</strong>{" "}
                <span className="badge badge-ok">
                  {shortLightLabel(light.type)}
                </span>{" "}
                <span className="muted">
                  intensity {light.intensity.toFixed(2)}
                </span>
                {light.color && (
                  <>
                    {" "}
                    <span
                      className="badge"
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
        </details>
      )}
      {cameras.length > 0 && (
        <details className="card-details" open>
          <summary className="card-path">
            Cameras <span className="muted">({cameras.length})</span>
          </summary>
          <ul className="card-list">
            {onSelectCamera && (
              <li className="issue">
                <button
                  className={`badge${activeCameraName === null ? " badge-ok" : ""}`}
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => onSelectCamera(null)}
                  type="button"
                  title="Switch to free-orbit camera"
                  aria-pressed={activeCameraName === null}
                >
                  Free Orbit
                </button>
              </li>
            )}
            {cameras.map((camera) => (
              <li key={camera.id} className="issue">
                <strong>{camera.name}</strong>{" "}
                <span className="badge badge-ok">{camera.projection}</span>{" "}
                <span className="muted">
                  fov {formatFov(camera.fov)} · aspect{" "}
                  {formatAspect(camera.aspect)} · near {camera.near.toFixed(3)}{" "}
                  · far {camera.far.toFixed(1)}
                </span>
                {onSelectCamera && (
                  <>
                    {" "}
                    <button
                      className={`badge${activeCameraName === camera.name ? " badge-ok" : ""}`}
                      style={{ cursor: "pointer", border: "none" }}
                      onClick={() =>
                        onSelectCamera(
                          activeCameraName === camera.name ? null : camera.name,
                        )
                      }
                      type="button"
                      title={
                        activeCameraName === camera.name
                          ? "Reset to free orbit"
                          : `Use ${camera.name} as active camera`
                      }
                      aria-pressed={activeCameraName === camera.name}
                    >
                      {activeCameraName === camera.name ? "Active" : "View"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
