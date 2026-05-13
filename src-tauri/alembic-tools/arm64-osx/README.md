`abc_to_obj` is built for macOS arm64 from `../src/abc_to_obj.cpp` and bundled
in this directory. `build.rs` reuses the committed helper by default; set
`ALEMBIC_FORCE_BUILD=1` with vcpkg available to regenerate it.

The Tauri command resolves this platform path at runtime:

```text
alembic-tools/arm64-osx/abc_to_obj
```

If the binary is missing, `.abc` preview fails with a readable "not bundled for
this platform" error instead of showing an empty viewport.
