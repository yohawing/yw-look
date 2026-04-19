# Changelog

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
