# Changelog

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
