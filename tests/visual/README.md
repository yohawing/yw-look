# Visual regression tests

`npm run test:visual` captures the `?entry=selftest` page through Playwright and
compares it with `tests/visual/snapshots/selftest-page-linux-chromium.png`.

`npm run test:viewport-snapshot` renders representative 3D viewport cases
through the shot CLI and compares the generated PNGs with committed baselines in
`tests/visual/snapshots/viewport/`.

The viewport snapshot cases use small public samples from `samples/assets/` and
write current renders to `artifacts/screenshots/viewport/`. On mismatch, keep
the actual image, FLIP error map, and report for review.

## Viewport comparison

The default comparison uses **NVIDIA FLIP** — a perceptual image diff metric
that tolerates minor antialiasing, GPU driver, and floating-point differences.

If the perceptual error is below threshold, the test passes even when pixels
differ byte-for-byte.

### Thresholds

| Metric          | Default | Env override          |
| --------------- | ------- | --------------------- |
| Mean FLIP error | 0.05    | `FLIP_MEAN_THRESHOLD` |
| Max FLIP error  | 0.30    | `FLIP_MAX_THRESHOLD`  |

FLIP error ranges from 0.0 (identical) to 1.0 (completely different). The
mean is the recommended single-number summary (per the FLIP paper).

### Strict mode

To fall back to exact PNG byte comparison, use `--strict`:

```bash
npm run test:viewport-snapshot -- --strict
```

### Failure artifacts

When FLIP comparison fails, these artifacts are written next to the current
render in `artifacts/screenshots/viewport/`:

- `*-flip-error.png` — magma-colored FLIP error map
- `*-flip-report.json` — full FLIP metrics (mean, max, min, percentiles, thresholds)

CI uploads all `artifacts/screenshots/**/*.png` so error maps are visible in
the workflow run.

### Updating baselines

After an intentional rendering change, regenerate baselines:

```bash
UPDATE_SNAPSHOTS=1 npm run test:viewport-snapshot
```

or:

```bash
npm run test:viewport-snapshot:update
```

Both commands overwrite the committed snapshot PNGs with the current renders.
Review the diffs and commit.

### Tuning thresholds

If the default thresholds are too strict or too loose for a particular
environment, override them:

```bash
FLIP_MEAN_THRESHOLD=0.08 FLIP_MAX_THRESHOLD=0.40 npm run test:viewport-snapshot
```

Consider updating the defaults if a threshold change proves stable across CI
and local runs.
