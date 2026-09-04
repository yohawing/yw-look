# USD stateful payload regression

`npm run test:usd-stateful-regression -- --shot-binary <native-exe>` extracts the GLBs in `usd-stateful-cases.json` from one `NoPayloads` session, renders each GLB, and compares strict decoded PNG pixels with the self-authored baselines in `snapshots/usd-stateful/`. Pass `--update-snapshot` to create a missing baseline or replace an existing, dimension-valid baseline after all captures and state comparisons pass.

The current corpus covers only `tiny_payload.usda`: loaded, unloaded, then reloaded. Its authored inline and payload quads overlap, so `fixtures/tiny_payload_visual.usda` sublayers it and applies only a translation override to the payload root. This makes the visual state difference observable without changing the source fixture. `timeCode` must be `null` because the session extractor has no time-sampling capability. Variants and other unsupported USD capability cases remain separate TODO work.

Baselines are native WebView2 provenance for the capturing Windows environment. Cross-OS pixel equivalence is not asserted by this slice.

Expected diagnostics cover only payload operations and geometry extraction in this test adapter; they do not claim coverage of the viewer's full diagnostics surface.
