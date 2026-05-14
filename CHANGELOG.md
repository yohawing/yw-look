# Changelog

## v0.1.11 (2026-05-14)

### Loaders and preview

- Added Alembic static previews and animated geometry-cache playback.
- Added optional MMD preview support, then kept the experimental entry hidden from the default UI.
- Improved missing texture fallback behavior for FBX and other texture references.
- Added native USD instance-proxy support and kept heavy USD loads responsive.

### Viewer and diagnostics

- Added shared object inspection for non-USD formats and morph-target controls in the outliner.
- Added viewport toolbar presets, hover submenus, and normalized model scale controls.
- Added process memory and resource usage diagnostics, with clearer diagnostics resource rows.
- Split viewer warning presentation in diagnostics and simplified file-info disclosure.

### Build, release, and docs

- Added prebuilt OpenUSD payload extraction and macOS OpenUSD payload support.
- Bundled the macOS Alembic helper and allowed prebuilt OpenUSD startup without a local vcpkg root.
- Built the FLIP comparison helper during release bundling so Tauri's package binary scan has all expected binaries.
- Made local Windows update feed generation select the installer that matches the current release version.
- Split the fast typecheck backend path.
- Moved planning docs under `docs/`, refreshed README / CLI notes, and added MIT license metadata.

## v0.1.10 (2026-05-07)

### Viewer and loaders

- Added VRM preview support through the loader registry.
- Improved optional loader error handling so missing optional formats are
  reported distinctly from real load failures.
- Made USD loading tolerate deferred payload-only stages and suppress
  warnings for nested payloads that resolve successfully.
- Tolerated Bistro FBX animation curve gaps during preview loading.

### Updates and release infrastructure

- Surfaced available app updates in the UI.
- Preferred the NSIS artifact in the public Windows updater manifest.
- Added macOS release guards so tagged releases fail before publishing if
  Developer ID / notarization secrets or `darwin-aarch64` updater metadata
  are missing.
- Recorded the current macOS signing-secret status and Apple Silicon release
  boundary in the distribution docs.

### Testing and docs

- Added a fixture regression catalog and private sample cases for Bistro and
  Kitchen Set coverage.
- Added private sample fetch targeting and documented the private glTF sample
  workflow.
- Documented optional loader pack strategy and non-USD Rust backend scope.

## v0.1.9 (2026-05-03)

### USD workflow

- Added USD variant-set switching, purpose filtering, payload
  load/unload controls, per-prim metadata inspection, relationship and
  attribute panels, layer-stack details, time-sample details, and USDA
  root-layer source preview.
- Improved USD preview parity with stable hierarchy selection keys,
  viewport-to-tree mesh selection sync, camera switching, light
  enumeration, bound-mesh material details, RGBA displayColor /
  displayOpacity handling, PointInstancer previews, and Z-up correction
  for synthetic up-axis nodes.
- Ported more hierarchy construction to the C++ backend and propagated
  typed errors through stage flattening, variant selection, and shim
  callback paths.
- Made the loader fail closed for composition-bearing USD files when a
  JavaScript fallback would otherwise hide unsupported composition
  semantics.

### Viewer and desktop

- Added Finder open-file handling on macOS.
- Added an auto-check-for-updates toggle.
- Added UE-style RMB + WASD fly camera controls.
- Refined the loading experience with a console-style loading screen,
  real loading-stage reporting, and diagnostics counts in the chrome.
- Reworked sidebar, properties, files, and animation playback controls
  against the design-system brushup.
- Added a 2D / 3D toggle for texture preview.

### Testing and release infrastructure

- Added headless shot/check commands, viewport snapshot regression
  tests, pixel comparison, and batch-load coverage.
- Added load-regression benchmark scripts and sample-fetch support for
  multi-file and zip-based reference models.
- Clarified macOS distribution boundaries and release requirements.
- Skipped the expensive C++ backend workflow on develop while keeping
  release/main coverage.

## v0.1.2 (2026-04-19)

### USD backend

- C++ OpenUSD backend (Pixar OpenUSD via vcpkg + handwritten C shim)
  promoted to the default build. The pure-Rust fork (`yohawing/openusd`)
  stays opt-in via `--no-default-features --features backend-openusd-rs`
  for parity verification and Linux hosts (vcpkg OpenUSD is Windows +
  macOS only; Linux surfaces a `compile_error!` unless the Rust fork
  feature is selected).
- UsdPreviewSurface material pipeline covering scalar inputs
  (diffuseColor / metallic / roughness / opacity / emissiveColor),
  texture resolution (USDZ archive + filesystem search), normal maps,
  ORM-packed metallicRoughness texture, `wrapS` / `wrapT` sampler
  modes, `UsdTransform2d` → `KHR_texture_transform`, and alphaMode
  OPAQUE / MASK / BLEND (opacityThreshold).
- MaterialX shader-graph coverage: `ND_UsdPreviewSurface` /
  `ND_UsdPreviewSurface_surfaceshader`, `ND_image_color3 / color4 /
vector2 / vector3 / vector4 / float`, `ND_tiledimage_color3 / 4`,
  and the `ND_normalmap` wrapper.
- `GeomSubset` per-face material splitting (materialBind family).
- UsdSkel pipeline: skeleton extraction, per-vertex skinning, ARKit
  rigid-follow synthesis for meshes that author `skel:joints` without
  per-vertex indices, `UsdSkelAnimation` time-sampled TRS, and
  `UsdSkelBlendShape` morph targets with `blendShapeWeights`
  time-sampled animation.
- UsdLux DistantLight / SphereLight and UsdGeomCamera perspective
  cameras.
- `primvars:displayColor`: constant interpolation promotes to a
  dedicated material slot; per-vertex / faceVarying flows through
  glTF `COLOR_0`.
- Skeleton wrapper node preserves the Skeleton prim's composed world
  transform on skinned meshes, fixing a 100× scale mismatch between
  the chameleon's body and its branch on ARKit USDZ assets.

### Infrastructure

- `ci-cpp-backend.yml` runs on `develop` pushes and PRs, with vcpkg
  binary cache + `Swatinem/rust-cache` for build reuse across runs.
- `scripts/preview-model.mjs` honors `YW_LOOK_USD_BACKEND=cpp|rs` for
  side-by-side backend comparisons during visual debugging.
- Added `default-run = "yw-look"` in `src-tauri/Cargo.toml` so
  `cargo run` keeps targeting the Tauri binary alongside helper
  CLIs like `usd_to_glb`.

### Fixtures

- `samples/assets/usd/tiny_material.usda` — UsdPreviewSurface scalar
  authoring round-trip.
- `samples/assets/usd/tiny_alpha.usda` — alphaMode BLEND / MASK
  regression coverage.
- `samples/assets/usd/tiny_rigged_blend.usda` — blend-shape weight
  animation smoke test.

## v0.1.1 (2026-04-12)

### 3D Formats

- USD / USDA / USDC / USDZ support (GLB conversion via Rust backend)
  - PBR materials, texture embedding, skins, animations, variant sets
- COLLADA (.dae) loader

### Textures

- KTX2 loader
- Texture viewer improvements (gamma, exposure, tiling)

### Viewer

- FXAA post-processing
- Shadow rendering
- displayColor / per-vertex color support

### Desktop Integration

- Native menu bar
- In-app updater (GitHub Releases)
- File associations (3D models + textures)

### Infrastructure

- CI pipeline (lint, typecheck, Rust check, integration test, visual regression)
- Windows NSIS / MSI bundling

## v0.1.0

Initial release. Supports glTF, FBX, OBJ, PLY, STL and common image formats.
