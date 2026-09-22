# Third-Party Notices

yw-look bundles third-party code and assets. The licenses below apply to
those materials and are not replaced by any terms that cover yw-look itself.

## Basis Universal transcoder

The bundled Basis Universal transcoder (`basis_transcoder.js` and
`basis_transcoder.wasm`) is from
[Basis Universal](https://github.com/BinomialLLC/basis_universal) and is
provided under the Apache License 2.0.

## ufbx

Native FBX preview import statically links
[ufbx](https://github.com/ufbx/ufbx) through its official Rust bindings.
ufbx and the bindings are available under `MIT OR PDDL-1.0`.

## web-ifc

The IFC loader bundles [web-ifc](https://github.com/ThatOpen/engine_web-ifc)
under the Mozilla Public License 2.0. yw-look uses the published package
unmodified; its source is available from that repository and from
[npm](https://www.npmjs.com/package/web-ifc).

## Sample assets

Sample assets include materials derived from the
[Khronos glTF Sample Models](https://github.com/KhronosGroup/glTF-Sample-Models)
and [three.js example assets](https://github.com/mrdoob/three.js/tree/dev/examples/models).
Each asset remains subject to its upstream license and attribution terms.

## Dependency notices

JavaScript, Rust, Tauri, operating-system, SDK, and build-tool dependencies
remain subject to their respective licenses. Release builds generate the
application's dependency attribution data from the locked dependency set.
