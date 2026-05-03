# Overlay triplet for yw-look.
#
# Copies vcpkg's upstream arm64-osx triplet at baseline
# b83a134447208c35f740e4b6faf1263b0d6e860e verbatim and adds one
# override:
#
#   VCPKG_OSX_DEPLOYMENT_TARGET = 11.0
#
# Upstream at this baseline leaves the deployment target unset, so
# USD's own CMake falls back to 10.13. libc++ gates `<filesystem>`
# (std::filesystem::path, u8string, filesystem_error) behind 10.15,
# causing pegtl's file_reader.hpp to fail to compile with `'path' is
# unavailable: introduced in macOS 10.15` during the OpenUSD build.
# Pin to 11.0 — the lowest macOS version that ships Apple Silicon —
# so the filesystem symbols are always available.
#
# VCPKG_LIBRARY_LINKAGE is kept at upstream's `static` value because
# the `usd` port's portfile forces `ONLY_DYNAMIC_LIBRARY` regardless,
# so changing it here would drift from upstream without any effect.
set(VCPKG_TARGET_ARCHITECTURE arm64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)

set(VCPKG_CMAKE_SYSTEM_NAME Darwin)
set(VCPKG_OSX_ARCHITECTURES arm64)
set(VCPKG_OSX_DEPLOYMENT_TARGET "11.0")
