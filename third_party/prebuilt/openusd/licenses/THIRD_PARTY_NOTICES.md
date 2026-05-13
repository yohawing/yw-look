# Prebuilt OpenUSD Runtime Notices

The prebuilt OpenUSD payloads in `third_party/prebuilt/openusd/` include
runtime and build-support files from the vcpkg packages listed below.

- Pixar OpenUSD: see `USD-LICENSE.txt`
- oneAPI TBB: see `TBB-LICENSE.txt`
- hwloc: see `HWLOC-LICENSE.txt`
- zlib: see `ZLIB-LICENSE.txt`

When adding a new triplet payload, regenerate these notices from the matching
`vcpkg_installed/<triplet>/share/*/copyright` files and add any newly bundled
native dependency licenses before committing the zip.
