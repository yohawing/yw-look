import { useMemo } from "react";

const sampleFormats = [
  "glb",
  "gltf",
  "fbx",
  "obj",
  "ply",
  "stl",
  "tga",
  "dds",
  "ktx2",
  "hdr",
  "exr",
  "usd",
];

export function App() {
  const formatList = useMemo(() => sampleFormats.join(" / "), []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Asset Quick Look</p>
          <h1>yw-look</h1>
        </div>
        <div className="topbar-actions">
          <button disabled type="button">
            Open
          </button>
          <button disabled type="button">
            Prev
          </button>
          <button disabled type="button">
            Next
          </button>
        </div>
      </header>

      <section className="viewer-panel">
        <div className="viewer-placeholder">
          <p className="viewer-label">Viewer Placeholder</p>
          <h2>Tauri + React + Three.js base is ready for implementation.</h2>
          <p>
            Next steps are wiring file open, initializing the Three.js scene,
            and loading sample assets from <code>samples/manifest.json</code>.
          </p>
        </div>
      </section>

      <section className="info-grid">
        <article className="card">
          <p className="card-title">Current Scope</p>
          <ul>
            <li>Minimal desktop shell</li>
            <li>Vite dev server on port 1420</li>
            <li>Tauri v2 desktop host</li>
            <li>Three.js ready for viewer integration</li>
          </ul>
        </article>

        <article className="card">
          <p className="card-title">Verification Samples</p>
          <p>{formatList}</p>
          <p className="muted">
            Sample manifest and downloaded public assets are already prepared.
          </p>
        </article>

        <article className="card">
          <p className="card-title">Debug Workflow</p>
          <ul>
            <li>Read `プラン.md`, `ToDo.md`, `AGENTS.md`</li>
            <li>Use `samples/manifest.json` for repeatable checks</li>
            <li>Write screenshots to `artifacts/screenshots/`</li>
            <li>Write logs to `artifacts/logs/`</li>
          </ul>
        </article>
      </section>

      <footer className="statusbar">
        <span>Status: setup complete</span>
        <span>Next: initialize viewer and sample loader</span>
      </footer>
    </main>
  );
}
