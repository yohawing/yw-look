# Changelog

## v0.3.0 (2026-07-19)

### Viewer and loader packs

- Made the pure-Rust OpenUSD implementation the sole USD backend, removed the C++ runtime payload, and pinned the compatibility source used by local, CI, and release builds.
- Made fully loaded USD previews the default while retaining deferred payload loading as an explicit asynchronous mode, with more reliable payload sessions, inspection retries, and error reporting.
- Moved heavy FBX, glTF, OBJ, DAE, USD, and Alembic preparation away from the main thread where practical, reduced redundant scene traversals and texture decoding, and improved cancellation of stale loads.
- Expanded Optional Loader Pack management across manifests, compatibility reporting, Settings actions, file associations, build profiles, and NSIS component selection for VRM, MMD, and Gaussian Splat support.
- Updated the MMD loader, added PMX material morph playback and regression coverage, restored standalone VMD playback, and bundled the preview model used by release builds.
- Improved skeleton, animation, high-poly selection, material, texture, camera, light, and USD inspection behavior across supported formats.

### Reliability and diagnostics

- Added persistent application diagnostics, crash recovery records, release-safe log redaction, frontend fatal-error capture, diagnostics access from Settings, and a prefilled issue-reporting path.
- Added stronger binary-read boundaries, stale file-open protection, blob URL cleanup, loader abort handling, release content security policy, and loopback-only updater overrides.
- Added public fixture, viewport snapshot, loader-pack, startup, responsiveness, and local visual-review coverage, with test-count drift enforced against the documented QA inventory.

### Interface

- Adopted shared Radix-based dialog, popover, and tooltip primitives and consolidated repeated sidebar, toolbar, status, warning, material, and file-list UI.
- Refined viewport tool grouping and icons, recent-file presentation, long-path tooltips, skeleton overlays, animation metadata, texture split panes, and standalone image behavior.
- Hid development-only diagnostics and controls from release builds while keeping actionable warnings and failure details visible.

### Build and release

- Added release-note contract checks, consolidated local release preflight reporting, updater-manifest validation, local updater-feed smoke tests, and Windows/macOS signing audit reports.
- Added loader-enabled Windows bundle profiles and checks that verify NSIS/MSI artifacts, updater signatures, generated installer hooks, and all three Optional Loader Packs.
- Added packaged startup measurement, reproducible IPC type generation checks, and release-checkout-safe OpenUSD dependency resolution.

### Known limitations

- Windows installers do not yet have production Authenticode signing; SmartScreen may identify the publisher as unknown.
- The macOS artifacts for this tag have not yet been built, notarized, stapled, or exercised through Gatekeeper on a clean Mac.
- Optional Loader Pack selection is covered by generated-hook and bundle checks, but the final v0.3.0 NSIS component page still requires a human interactive install check.
- GitHub Release installation and updater roundtrips cannot be completed until the v0.3.0 artifacts and `latest.json` are published.
- MMD physics remains disabled by default; MMD model and motion preview support does not imply production physics parity.

### Distribution verification

#### Windows signing and SmartScreen

- Status: not verified
- Details: the local v0.3.0 NSIS and MSI bundles were produced with updater signatures, and `npm run check:nsis-loader-pack-bundle` verified all three Optional Loader Packs. `npm run check:win-authenticode` audited the NSIS installer, MSI installer, and application executable as 0 valid, 3 unsigned, and 0 invalid; SmartScreen remains unverified on a clean Windows environment.

#### macOS codesign, notarization, and Gatekeeper

- Status: not verified
- Details: v0.3.0 macOS artifacts have not been produced yet. The release workflow requires Apple signing and notarization secrets, but `codesign`, notarization, stapling, Gatekeeper first launch, and Finder Open With must be confirmed from the final artifacts.

#### GitHub Release install and updater roundtrip

- Windows: not verified — the v0.3.0 GitHub Release installer and updater manifest do not exist until the tag is published; verify a clean install and an update from v0.2.2 after publication.
- macOS: not verified — the v0.3.0 GitHub Release DMG and updater manifest do not exist until the tag is published; verify a clean install and an update from v0.2.2 after publication.

## v0.2.2 (2026-05-31)

### Viewer and loaders

- Added Gaussian splat preview support for PLY, SPZ, SPLAT, KSPLAT, and SOG assets, including compressed SuperSplat PLY handling.
- Improved Gaussian splat orientation, centering, and camera targeting so splat scenes open upright without unwanted bounds auto-framing, while preserving SPZ's native Y axis.
- Registered splat formats with the desktop app so they appear in OS file-opening flows.
- Completed deferred USD payload preview loading and aligned progress reporting for deferred payload sessions.
- Added a CC0 SuperSplat compressed PLY fixture to guard Gaussian splat classification against real captured data.

### Build and release

- Included platform-specific Tauri overlay configs in local Windows and macOS bundle scripts.
- Updated the Optional Loader Pack dependency and kept frontend preview-support tables aligned with newly supported splat formats.

### Refactoring

- Split large app state and command modules into focused stores, hooks, command modules, and shared type definitions.
- Centralized error handling and design tokens, and normalized formatting after the refactor.

### Known limitations

- Windows NSIS and MSI installers ship without Authenticode signing; SmartScreen may warn about an unknown publisher on first launch.
- macOS DMG and app bundles are not Developer ID signed or notarized; Gatekeeper may block or require manual override on first launch.
- Optional Loader Pack component selection in the NSIS installer UI was not confirmed for this tag; MMD and Gaussian Splat pack installation state should be verified outside the published installer.
- GitHub Release install and updater roundtrip from production artifacts has not been confirmed on clean Windows or macOS machines for this tag.

### Distribution verification

#### Windows signing and SmartScreen

- Status: not verified
- Details: v0.2.2 Windows bundle artifacts were not Authenticode signed at release time. `Get-AuthenticodeSignature` was not run against the published NSIS or MSI installers, and SmartScreen behavior on a clean Windows environment was not recorded for this tag.

#### macOS codesign, notarization, and Gatekeeper

- Status: not verified
- Details: v0.2.2 macOS bundle artifacts were not Developer ID signed, notarized, or stapled at release time. `codesign -dv`, `notarytool`, `stapler validate`, Gatekeeper first-launch, and Finder Open With were not confirmed on a clean macOS environment for this tag.

#### GitHub Release install and updater roundtrip

- Windows: not verified — a fresh install from the v0.2.2 GitHub Release NSIS installer and an in-app update via the published `latest.json` were not completed on a clean machine.
- macOS: not verified — a fresh install from the v0.2.2 GitHub Release DMG and an in-app update via the published `latest.json` were not completed on a clean machine.

## v0.2.1 (2026-05-26)

### Release

- Fixed the macOS release build by importing the Tauri event emitter trait used by Finder open-file handling.
- Consolidated the release checklist into `docs/release-distribution.md` and documented the Optional Loader Pack release check.
- Added USD load timing diagnostics used during release performance validation.

## v0.2.0 (2026-05-25)

### MMD サポートの本格化

- MMD (MikuMikuDance) モデルの Tauri シェル上でのプレビューを有効化。
- VMD モーションファイルのドロップ再生と Ammo.js 物理シミュレーションに対応。
- アウトライン・アルファ描画、組み込みトゥーンテクスチャの解決、ローカルテクスチャのキャッシュを追加。
- MMD 専用ライティングプリセットを適用し、MMD 例示ビューアとの見た目を揃えた。
- モデルスケールの保持とディフューズテクスチャの正しい反転表示を修正。
- アウトラインメッシュのワイヤーフレーム表示と変形後プロキシ表示を追加。
- MMD ボーン・モーフ・マテリアルの詳細メタデータ検査パネルを整備。
- MMD 診断情報を Warnings カードに統合し、アダプタを optional 依存に分離。

### ビューアー

- メッシュワイヤーフレームオーバーレイを追加（unlit マテリアル使用）。
- USD ペイロードをデフォルトで読み込むよう変更。
- ネイティブメニューバーを削除（不要 UI の整理）。

### パフォーマンス

- 階層選択ツリーのトラバーサルを削減し選択レスポンスを改善。
- ビューポート選択の処理量を削減。

### 診断・ビルド

- Tauri シェル外での native API 呼び出しをガード。
- Windows MSVC 環境の Tauri dev 起動エラーを修正。
- macOS Tauri スキーマを更新。

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

- Bundled the macOS Alembic helper.
- Built the FLIP comparison helper during release bundling so Tauri's package binary scan has all expected binaries.
- Made local Windows update feed generation select the installer that matches the current release version.
- Signed the bundled macOS Alembic helper before notarization.
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

## v0.1.2 (2026-04-19)

### USD backend

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
