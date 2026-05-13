# Optional Loader Pack Strategy

This document records the packaging and installation strategy for optional
format loaders such as VRM and MMD. It is a design boundary for #78, #70,
#71, and the future Loader Plugin Registry work in #72. Alembic `.abc` started
as a candidate here, but #69 now ships it through a core native helper instead
of an optional loader pack.

## Decision Summary

Optional loader packs are first-party, install-time components. They are not a
third-party plugin marketplace and must not execute arbitrary user-provided
JavaScript.

The core app ships with the built-in loaders needed for the normal lightweight
install. Optional packs are physically present only when selected by the
installer or when a development feature flag includes them. Missing packs are
reported as recognized-but-not-installed formats, distinct from truly
unsupported extensions and parse failures.

## Initial Pack Set

| Pack            | Extensions             | Purpose                                 |
| --------------- | ---------------------- | --------------------------------------- |
| VRM Loader Pack | `.vrm`, `.vrma`        | VRM model and animation preview support |
| MMD Loader Pack | `.pmd`, `.pmx`, `.vmd` | MikuMikuDance model / motion preview    |

## Package Layout

Installed packs live under the app resources directory:

```text
yw-look/
  optional-loaders/
    vrm/
      manifest.json
      loader.js
      assets/
    mmd/
      manifest.json
      loader.js
      assets/
```

Manifest shape:

```json
{
  "id": "vrm",
  "name": "VRM Loader Pack",
  "version": "0.1.0",
  "extensions": ["vrm", "vrma"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}
```

The manifest is metadata first. The first implementation may still import an
internal bundled module instead of dynamically evaluating `loader.js`, as long
as the registry exposes the same pack identity and extension availability.

## Startup Detection

At startup, the app scans `optional-loaders/*/manifest.json` from the app
resources directory and validates:

- `id` is one of the known first-party pack ids.
- `kind` is `firstPartyLoaderPack`.
- `extensions` only contains extensions assigned to that pack.
- `entry` resolves inside the pack directory.

Invalid manifests are ignored and logged to Diagnostics as warnings. They
should not prevent core loaders from working.

The Loader Plugin Registry (#72) should expose three states per extension:

- `implemented`: built into the core app or installed pack.
- `missingOptionalLoader`: recognized extension, pack not installed.
- `unsupported`: not recognized by the current app.

This matches the current user-facing error split used by the viewport.

## Installer Behavior

Windows NSIS should expose:

- Basic install: core app and core loaders only.
- Custom install:
  - VRM Loader Pack.
  - MMD Loader Pack.
  - Future optional packs as separate checkboxes.

Default selection should stay conservative: core only. Users who need niche
formats can opt in without increasing the base install size for everyone.

macOS DMG does not have an equivalent custom component picker. For macOS, ship
core only until a first-party in-app pack installer exists, or ship a separate
`yw-look-optional-loaders` package if demand justifies it.

## Update And Uninstall

Updater behavior:

- Core app updates must preserve installed pack directories unless the pack id
  is explicitly retired.
- Pack manifests include versions so the app can report stale pack versions.
- Core app compatibility should be checked by pack id and manifest schema, not
  only by file presence.

Uninstall behavior:

- Full app uninstall removes `optional-loaders/`.
- App updates do not remove optional packs automatically.
- A future pack-management UI can remove individual packs by deleting the pack
  directory after confirmation.

## UI Representation

The first-run and unsupported-format surfaces should present:

- Core formats as built in.
- Optional formats separately as requiring packs.
- Missing optional loaders with a direct message such as:

```text
VRM Loader Pack is not installed.
Install VRM Loader Pack to preview VRM files.
```

Technical details, manifest validation failures, and loader stack traces belong
in Diagnostics, not the primary viewport message.

## Security Boundary

This strategy intentionally does not allow arbitrary third-party code loading.
Before any external plugin distribution is considered, yw-look needs a separate
security design covering signing, trust, sandboxing, update channels, and crash
isolation.

Until then, optional packs are treated as first-party modules controlled by the
yohawing/yw-look release process.

## Implementation Order

1. Keep the current static extension classification for missing optional packs.
2. Add the Loader Plugin Registry (#72) with the same support-state model.
3. Add manifest scan and validation.
4. Wire NSIS Custom Install sections to copy selected pack directories.
5. Implement VRM (#70) and MMD (#71) as first-party packs.
6. Add pack version and compatibility reporting in Settings / Diagnostics.
