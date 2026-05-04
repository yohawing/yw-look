# Non-USD Rust Backend Evaluation

This document records the #81 decision pass for heavy processing outside USD.
It does not move work to Rust by itself; it defines which workloads are worth
splitting into follow-up implementation issues.

## Current State

Non-USD preview loading still mostly happens in the WebView:

- `src/viewer/loaders.ts` reads file bytes through `read_binary_file`.
- Three.js loaders decode GLB/glTF/FBX/OBJ/PLY/STL/DAE and standalone textures.
- `DDSLoader`, `RGBELoader`, `EXRLoader`, `TGALoader`, and `KTX2Loader` own
  texture decode / upload behavior.
- `src-tauri/src/lib.rs` already provides cheap file inspection and DDS header
  dimensions through `inspect_asset`.
- Private load benchmarks track end-to-end load success and frame timings, but
  texture-only heavy cases are not yet first-class benchmark targets.

The main constraint is that decoded renderable texture data must eventually
reach WebGL. Moving full decode to Rust can add IPC copies unless Rust produces
a smaller metadata/preflight result or a GPU-ready compressed payload.

## Decision Matrix

| Candidate                                 | Decision              | Rationale                                                                                                        |
| ----------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Generic file metadata                     | Keep in Rust          | Already cheap and useful before preview load. Continue extending `inspect_asset` for size, timestamps, and kind. |
| Texture dimensions before GPU upload      | Move more to Rust     | Header-only reads can improve File Info and diagnostics without full decode or WebGL upload. Start with EXR/HDR. |
| DDS compressed texture inspection         | Move metadata to Rust | DDS headers expose dimensions, mip count, and FourCC/DXGI format. Keep actual preview in Three.js for now.       |
| EXR decode for preview                    | Keep in WebView       | Full float decode must still become a WebGL texture; Rust-side decode would likely add memory copies today.      |
| HDR decode for preview                    | Keep in WebView       | Same as EXR; RGBELoader already feeds Three.js texture flow directly.                                            |
| KTX2/Basis transcoding                    | Keep in WebView       | Three.js KTX2Loader coordinates transcoder workers and renderer capability detection.                            |
| Large-file preflight scanning             | Add Rust command      | A bounded preflight can report file size, probable format, dimensions, mip count, and risk warnings quickly.     |
| Hashing / cache keys                      | Add Rust command      | Streaming hash avoids loading whole large files into the WebView just to key caches or benchmark reports.        |
| Generic non-USD scene metadata extraction | Defer                 | Format-specific parsers would duplicate Three.js loader behavior; wait for concrete user-facing need.            |
| Optional format preprocessors             | Defer to pack design  | Belongs to the first-party optional loader pack boundary from `docs/optional-loader-packs.md`.                   |

## Recommended Follow-Ups

### 1. Texture Header Preflight Command

Add a Tauri command such as `inspect_texture_header(path)` returning:

- width / height
- texture container (`dds`, `hdr`, `exr`, `ktx2`, `tga`, `png`, `jpeg`)
- channel / component hints when cheap
- mip count / compression family for DDS and KTX2 when available
- warning strings for unusually large dimensions or unsupported compression

This should be header-only and must not decode full pixel payloads.

### 2. Large Asset Preflight Command

Add a bounded `preflight_asset(path)` command used before expensive preview
loads and benchmarks. It should return:

- file size
- extension and inferred kind
- header-derived dimensions when available
- risk flags such as `largeFile`, `largeTexture`, `manyMipLevels`, or
  `unknownCompressedTexture`

This can feed Diagnostics (#76), first-load warnings, and stress-test reporting
(#73) without changing render output.

### 3. Streaming Hash Command

Add a Rust-side streaming hash for benchmark identity and future cache keys.
Do not use WebView `read_binary_file` for this because it transfers the whole
file as a JSON number array before the hash can be computed.

## Explicit Non-Goals For Now

- Do not replace Three.js EXR / HDR / KTX2 preview loaders wholesale.
- Do not move full texture decode to Rust until there is a GPU upload path that
  avoids extra copies.
- Do not add native FBX / OBJ / DAE parsers just for metadata without a clear
  UI requirement.
- Do not turn optional loader packs into arbitrary external plugin execution.

## Relationship To Other Work

- #73 should use Rust preflight fields for memory / stress-test reports when
  available.
- #76 can display preflight-derived dimensions, compression, and risk flags in
  diagnostics without waiting for full preview load.
- #78 defines the optional-loader packaging boundary for future preprocessors.
- USD remains the only format family where Rust owns deep scene inspection and
  geometry extraction today.

## Final Recommendation

Move cheap, bounded, header-level inspection and streaming file operations to
Rust. Keep full non-USD preview decode in the WebView / Three.js path until a
specific format proves that Rust can reduce total memory or latency after IPC
costs are included.
