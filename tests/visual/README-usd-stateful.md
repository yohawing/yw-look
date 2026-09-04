# USD stateful regression

`npm run test:usd-stateful-regression -- --shot-binary <native-exe>` extracts the GLBs in `usd-stateful-cases.json` using one `NoPayloads` session per case, renders each passing GLB, and compares strict decoded PNG pixels with the self-authored baselines in `snapshots/usd-stateful/`. Captures within a case share their session. Pass `--update-snapshot` to create a missing baseline or replace an existing, dimension-valid baseline after all captures and state comparisons pass. The final `gate-summary.json` records machine-readable `PASS`, `XFAIL`, `FAIL`, and `XPASS` counts.

The payload case uses `relationship: "payload"` and covers only `tiny_payload.usda`: loaded, unloaded, then reloaded. Its authored inline and payload quads overlap, so `fixtures/tiny_payload_visual.usda` sublayers it and applies only a translation override to the payload root. This makes the visual state difference observable without changing the source fixture. Cases with `relationship: "independent"` do not run payload relationship checks. The variant case uses one `NoPayloads` session for `variant-default`, `variant-blue`, and `variant-reset`: the authored `Root.look = "red"` is captured first, only the middle capture selects `Root.look = "blue"`, and the empty selection resets to the authored default. The relationship gate requires exact GLB and PNG equality between default and reset, a difference for blue, and matching mesh/node evidence before any baseline update. The animated-Xform case remains a typed expected failure because `timeCode` is rejected by this capture adapter before extraction; it is XFAIL only when origin, code, and exact message match the approved signature.

Baselines are native WebView2 provenance for the capturing Windows environment. Cross-OS pixel equivalence is not asserted by this slice.

Expected diagnostics cover only payload operations and geometry extraction in this test adapter; they do not claim coverage of the viewer's full diagnostics surface. The animated fixture authors USD time samples at `t = 1` and `t = 24` with `timeCodesPerSecond = 24`; the adapter XFAIL does not claim live evaluated-Xform playback.

The independent GLB profiles validate extracted values before any baseline update:

- `material-subsets` comes from `fixtures/material_subsets.usda` and checks the two face meshes retain their distinct material assignments and positions.
- `authored-normals` comes from `fixtures/authored_normals.usda` and checks the authored tilted normal vectors survive extraction.
- `skinning` uses the shared `samples/assets/usd/tiny_rigged.usda` fixture and checks joints, inverse bind matrices, normalized weights, and animation channels. Its screenshot, when captured, represents the initial pose only.
- `point-instancer` uses the shared `samples/assets/usd/tiny_point_instancer.usda` fixture and checks prototype identity and instance translation values.
- `variant-red` and `variant-blue` use `fixtures/variant_override.usda` and check that the selected red or blue quad has the expected geometry, material color, and common inline anchor.

The timeCode case remains an adapter-owned XFAIL: it proves the explicit unsupported path, while the animated fixture and the profile checks do not claim live time-sampled Xform playback.
