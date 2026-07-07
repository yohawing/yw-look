# Benchmarks

## Startup bench

`npm run bench:startup` measures startup timing for selected surfaces and writes
JSON / Markdown reports under `artifacts/logs/startup-bench-<timestamp>/`.

Surfaces:

- `shot` (default): dev Tauri shot-startup smoke via `scripts/run-shot.mjs`
- `playwright`: Vite dev server app-shell first render in headless Chromium
- `packaged`: packaged/release executable first render in the normal app shell

Examples:

```bash
npm run bench:startup -- --surface playwright --iterations 1
npm run bench:startup -- --surface packaged --iterations 1
npm run bench:startup -- --surface packaged --app src-tauri/target/release/yw-look.exe --iterations 3
```

`--surface packaged` requires an existing built executable with a frontend that
includes the startup-bench hook. Rebuild before measuring:

```bash
npm run build
npm run tauri build -- --no-bundle
```

On Windows the default path is `src-tauri/target/release/yw-look.exe`. Pass
`--app <path>` to override it. Each packaged iteration launches a fresh process,
waits for the app to write `startup-bench-app-result.json`, and records wall-clock
elapsed from process launch plus frontend Performance API metrics.

`--surface both` remains `shot` + `playwright` only.

## Load bench

`npm run bench:load` runs the private-asset load benchmark and writes a report
under `artifacts/bench/<timestamp>/`.

The benchmark is manual-only for now because it depends on `samples/private/`
assets and local GPU / WebView behavior. CI should keep running deterministic
selftests and visual snapshots; benchmark regressions are checked from local
reports.

## Workflow

1. Fetch or refresh private samples:

   ```bash
   npm run samples:fetch
   ```

2. Run the load benchmark:

   ```bash
   npm run bench:load
   ```

   To run only Pixar Kitchen Set:

   ```bash
   npm run bench:load -- --case pixar-kitchen-set --visible
   ```

   `--visible` keeps the Tauri WebView on-screen. Use it on macOS when
   checking frame or screenshot metrics; an off-screen WebView can throttle
   `requestAnimationFrame`.

3. Create or update the local baseline from the latest report:

   ```bash
   npm run bench:load:baseline
   ```

   To pin a specific report:

   ```bash
   npm run bench:load:baseline -- --report artifacts/bench/<timestamp>/report.json
   ```

4. Summarize heavy or representative real-asset metrics from a report:

   ```bash
   npm run bench:load:summary
   ```

   To pin a specific report:

   ```bash
   npm run bench:load:summary -- --report artifacts/bench/<timestamp>/report.json
   ```

   The summary writes `heavy-load-summary.json` and `heavy-load-summary.md`
   next to the source report. It includes cases tagged `heavy` and the
   representative USD composition case `pixar-kitchen-set`. Small GLB smoke
   cases are not treated as heavy.

   By default the command exits non-zero when the report has no heavy or
   representative cases. Pass `--allow-empty` to record that fact in the
   summary artifacts instead.

   A real heavy recording still requires running a heavy case first, for
   example:

   ```bash
   npm run bench:load -- --case bistro-interior --visible
   npm run bench:load:summary -- --report artifacts/bench/<timestamp>/report.json
   ```

5. Compare a later run against the local baseline:

   ```bash
   npm run bench:load:compare
   ```

   The comparison writes `comparison.json` next to the report.

## Tracked Metrics

The comparison checks the fixed report schema from `src/bench/benchTypes.ts`:

- load success and non-blank canvas
- console errors and captured error string
- minimum mesh count
- `openPipelineMs` (file resolve + sibling listing + preview load)
- `resolveFileMs`
- `listSiblingsMs`
- `loadTimeMs`
- `stageTimeMs.resolve` (USD backend preview decision / dependency scan)
- `stageTimeMs.decode` (USD GLB extraction for composed stages)
- `stageTimeMs.gpu` (WebView-side GLTF parse / upload stage)
- `stageTimeMs.scene`
- `frameTimeMs.p95`

The default thresholds are intentionally loose enough for local machine noise:

- load time: baseline `* 1.35 + 250ms`
- open pipeline time: baseline `* 1.35 + 250ms`
- frame p95: baseline `* 1.20 + 2ms`

Override thresholds when comparing:

```bash
npm run bench:load:compare -- --load-ratio 1.2 --load-slack-ms 150
```

For macOS "Open With" / Finder-open regressions, watch `openPipelineMs` first.
If only `resolveFileMs` or `listSiblingsMs` moves, the slowdown is in the native
open path rather than the Three.js / USD preview loader.

## Current Scope

`samples/private/models.json` includes the representative load cases, including
Pixar Kitchen Set for heavy USD composition and the larger glTF/GLB samples.
EXR / HDR / DDS are covered by fixture/selftest paths today; add them to the
private bench manifest before treating texture-only performance as tracked.
