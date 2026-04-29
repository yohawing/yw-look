import type { CameraEntry, LightEntry } from "./assetMetadata";

type SceneLightsCamerasCardProps = {
  lights: LightEntry[];
  cameras: CameraEntry[];
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
            {cameras.map((camera) => (
              <li key={camera.id} className="issue">
                <strong>{camera.name}</strong>{" "}
                <span className="badge badge-ok">{camera.projection}</span>{" "}
                <span className="muted">
                  fov {formatFov(camera.fov)} · aspect{" "}
                  {formatAspect(camera.aspect)} · near {camera.near.toFixed(3)}{" "}
                  · far {camera.far.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
