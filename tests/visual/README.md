# Visual regression tests

`npm run test:visual` captures the `selftest.html` page through Playwright and
compares it with `tests/visual/snapshots/selftest-page-linux-chromium.png`.

`npm run test:viewport-snapshot` renders a representative 3D viewport through the
shot CLI and compares the generated PNG with
`tests/visual/snapshots/viewport/usda-tiny-sanity.png`.

The viewport snapshot case uses `samples/assets/usd/tiny.usda` and writes the
current render to `artifacts/screenshots/viewport/usda-tiny-sanity-current.png`.
On mismatch, keep that actual image for review.

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
