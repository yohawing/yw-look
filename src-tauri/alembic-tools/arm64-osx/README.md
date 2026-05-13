Build `abc_to_obj` for macOS arm64 from `../src/abc_to_obj.cpp` and place the
executable in this directory before producing a macOS app bundle.

The Tauri command resolves this platform path at runtime:

```text
alembic-tools/arm64-osx/abc_to_obj
```

Until the binary is present, `.abc` preview fails with a readable "not bundled
for this platform" error instead of showing an empty viewport.
