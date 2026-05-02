# Benchmarks

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

3. Create or update the local baseline from the latest report:

   ```bash
   npm run bench:load:baseline
   ```

   To pin a specific report:

   ```bash
   npm run bench:load:baseline -- --report artifacts/bench/<timestamp>/report.json
   ```

4. Compare a later run against the local baseline:

   ```bash
   npm run bench:load:compare
   ```

   The comparison writes `comparison.json` next to the report.

## Tracked Metrics

The comparison checks the fixed report schema from `src/bench/benchTypes.ts`:

- load success and non-blank canvas
- console errors and captured error string
- minimum mesh count
- `loadTimeMs`
- `frameTimeMs.p95`

The default thresholds are intentionally loose enough for local machine noise:

- load time: baseline `* 1.35 + 250ms`
- frame p95: baseline `* 1.20 + 2ms`

Override thresholds when comparing:

```bash
npm run bench:load:compare -- --load-ratio 1.2 --load-slack-ms 150
```

## Current Scope

`samples/private/models.json` includes the representative load cases, including
Pixar Kitchen Set for heavy USD composition and the larger glTF/GLB samples.
EXR / HDR / DDS are covered by fixture/selftest paths today; add them to the
private bench manifest before treating texture-only performance as tracked.
