# Sample Sources

## Downloaded public samples

- `glb` / `gltf`
  Source: KhronosGroup glTF Sample Models
- `fbx`, `obj`, `ply`, `stl`, `tga`, `dds`, `ktx2`, `hdr`, `exr`
  Source: `three.js` example assets

## Locally generated tiny samples

- `samples/assets/obj/TinyTriangle.obj`
  Source: handcrafted minimal triangle mesh for smoke tests
- `samples/assets/stl/TinyTetrahedronAscii.stl`
  Source: handcrafted ASCII tetrahedron for lightweight STL checks

## USD Phase 0 PoC assets

- `samples/assets/usd/tiny.usda`
  Hand-written sanity asset. Single-file USDA with explicit `defaultPrim` / `upAxis` / `metersPerUnit`.
  Committed to the repo.
- `samples/private/usd/Kitchen_set/`
  Pixar Kitchen Set. Root is USDA, per-asset `*.geom.usd` files are USDC binary. Rich `references` and `payloads`.
  Source: https://openusd.org/release/dl_kitchen_set.html
  License: Pixar research / non-commercial. NOT committed.
- `samples/private/usd/chameleon_anim_mtl_variant.usdz`, `glove_baseball_mtl_variant.usdz`
  Apple AR Quick Look samples (USDZ ZIP container).
  Source: https://developer.apple.com/augmented-reality/quick-look/
  NOT committed.

## Notes

- These files are for local verification and debugging.
- Some formats are represented by a single small sample for now.
- Additional cases should be added over time for broken references, embedded textures, heavy files, and failure cases.
- Anything under `samples/private/` is excluded from git; obtain it from the upstream source listed above.
