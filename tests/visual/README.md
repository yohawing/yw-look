# Visual regression tests

`npm run test:visual` captures the `?entry=selftest` page through Playwright and
compares it with `tests/visual/snapshots/selftest-page-linux-chromium.png`.

`npm run test:viewport-snapshot` renders representative 3D viewport cases
through the shot CLI and compares the generated PNGs with committed baselines in
`tests/visual/snapshots/viewport/`.

The viewport snapshot cases use small public samples from `samples/assets/` and
write current renders to `artifacts/screenshots/viewport/`. On mismatch, keep
the actual image for review.

To update viewport baselines after an intentional rendering change:

```bash
UPDATE_SNAPSHOTS=1 npm run test:viewport-snapshot
```

or:

```bash
npm run test:viewport-snapshot:update
```

The comparison is currently an exact PNG byte match. If CI proves flaky across
GPU drivers or OS images, keep `scripts/viewport-snapshot.mjs` as the harness and
replace the isolated comparison function with a threshold-based PNG diff.
