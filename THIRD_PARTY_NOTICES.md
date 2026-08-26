# Third-Party Notices

This project includes third-party code and sample assets. The yw-look project
license does not replace the licenses that apply to those materials.

## Basis Universal transcoder

`public/basis/basis_transcoder.js` and `public/basis/basis_transcoder.wasm` are
from [Basis Universal](https://github.com/BinomialLLC/basis_universal) and are
provided under the Apache License 2.0.

## MMD preview stand-in assets

`src/packs/mmd-loader-pack/assets/yw_test_model.pmx` and its textures are copied
without modification from `three-mmd-loader/examples/viewer/assets/` at commit
`73ed9f4` and are provided under the MIT License from that project.

Model SHA-256:
`2A18F0B92D14E2C1ED8FA75E3390FB9BAD632BF3308460A04520357753675C0D`

## ufbx

Native FBX preview import statically links
[ufbx](https://github.com/ufbx/ufbx) through its official Rust bindings.
ufbx and the bindings are available under `MIT OR PDDL-1.0`.

## Sample assets

Public sample and test assets include materials derived from the
[Khronos glTF Sample Models](https://github.com/KhronosGroup/glTF-Sample-Models)
and [three.js example assets](https://github.com/mrdoob/three.js/tree/dev/examples/models).
Each asset remains subject to its upstream license and attribution terms.

Generated and hand-authored minimal fixtures are part of yw-look and are
covered by the project license unless a fixture records different provenance.

## Dependency notices

JavaScript, Rust, Tauri, operating-system, SDK, and build-tool dependencies
remain subject to their respective licenses. Release builds generate the
application's dependency attribution data from the locked dependency set.
