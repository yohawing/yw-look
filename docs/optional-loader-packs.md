# Optional Loader Pack Strategy

This document records the packaging, runtime, and Settings-panel strategy for
optional format loaders such as VRM and MMD. It is a design boundary for #78,
#70, #71, and the future Loader Plugin Registry work in #72. Alembic `.abc`
started as a candidate here, but #69 now ships it through a core native helper
instead of an optional loader pack.

## Decision Summary

Optional loader packs are first-party app-managed components. They are not a
third-party plugin marketplace and must not execute arbitrary user-provided
JavaScript.

The core app ships with the built-in loaders needed for the normal lightweight
install. Optional packs are physically present only when selected during
install, installed later from Settings, or enabled by a development feature
flag. Missing packs are reported as recognized-but-not-installed formats,
distinct from truly unsupported extensions and parse failures.

The Settings panel is the long-term source of truth for optional pack
management. Platform installers may seed the initial pack set, but they are not
the only way to add, remove, or disable optional loaders.

## Goals

- Keep startup dependencies simple for users who only need core formats.
- Keep cold startup fast by avoiding unnecessary loader initialization.
- Avoid registering file extensions for formats the user does not want.
- Keep niche or large loader implementations out of the core app boundary.
- Let users add, remove, enable, and disable first-party packs after install.
- Preserve installed packs across core app updates unless the pack is retired.

## Non-Goals

- Do not create an arbitrary third-party plugin marketplace.
- Do not load unsigned user-supplied JavaScript as a pack.
- Do not make the auto-updater responsible for interactive pack selection.
- Do not mix format-specific optional loader implementation details directly
  into core loader code beyond a stable registry boundary.

## Initial Pack Set

| Pack            | Extensions             | Purpose                                 |
| --------------- | ---------------------- | --------------------------------------- |
| VRM Loader Pack | `.vrm`, `.vrma`        | VRM model and animation preview support |
| MMD Loader Pack | `.pmd`, `.pmx`, `.vmd` | MikuMikuDance model / motion preview    |

## Package Layout

Installed packs live under an app-managed optional loader directory. For
installed apps this should be user-writable app data, not the signed app bundle,
so Settings and updates can modify packs on Windows and macOS:

```text
Application Support / AppData
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

Development and installer staging may also use a bundled resource directory,
but runtime detection should merge the app-managed directory first and treat it
as the persistent state. This avoids writing into a macOS `.app` bundle after a
drag-and-drop install and avoids losing packs during core app updates.

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

The manifest is metadata first. The first implementation may still call an
internal adapter for a known first-party pack instead of dynamically evaluating
`loader.js`, as long as the registry exposes the same pack identity and
extension availability.

## Startup Detection

At startup, the app scans `optional-loaders/*/manifest.json` from the
app-managed directory and any bundled seed directory, then validates:

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

The scan should be cheap. It should read manifests and compatibility metadata,
but it should not import heavy loader modules until the user opens a file that
requires that pack or explicitly toggles a pack on in Settings.

## Runtime State Model

Each known pack has two separate pieces of state:

- `installed`: the pack files and manifest are present and compatible enough to
  inspect.
- `enabled`: the user has allowed the app to register and use the pack.

Installed but disabled packs should not register preview loaders, file
associations, or drag/drop affordances for their extensions. The UI can still
show that the pack is available and disabled.

Per-extension support should then resolve as:

- `implemented`: core loader, or installed and enabled optional pack.
- `missingOptionalLoader`: known optional extension whose pack is not installed
  or is installed but disabled.
- `unsupported`: extension is not known to the current app.

If the distinction matters in UI copy, disabled packs can use a more specific
message such as:

```text
MMD Loader Pack is disabled.
Enable it in Settings to preview PMX files.
```

## Installer Behavior

Windows NSIS should expose an initial component choice:

- Basic install: core app and core loaders only.
- Custom install:
  - VRM Loader Pack.
  - MMD Loader Pack.
  - Future optional packs as separate checkboxes.

Default selection should stay conservative: core only. Users who need niche
formats can opt in without increasing the base install size for everyone.

The installer writes selected packs into the same app-managed pack directory
used by Settings, or copies bundled seed packs there on first launch. It should
not be the only management surface.

macOS DMG drag-and-drop install does not have an equivalent component picker.
For macOS, ship core only by default and let users install packs from Settings.
If demand justifies a heavier distribution, a separate "with optional loaders"
artifact can exist, but the app-managed directory must still be the runtime
source of truth.

## Update And Uninstall

Core updater behavior:

- Core app updates must preserve app-managed installed pack directories unless
  the pack id is explicitly retired.
- Pack manifests include versions so the app can report stale pack versions.
- Core app compatibility should be checked by pack id and manifest schema, not
  only by file presence.
- Auto-update should not present interactive pack selection. New packs should
  appear as available first-party packs in Settings after the core app learns
  about them.

Pack manager behavior:

- Settings can install a known first-party pack.
- Settings can enable or disable an installed pack.
- Settings can remove an installed pack after confirmation.
- Settings can update installed packs independently of core app updates when a
  compatible pack version is available.

Uninstall behavior:

- Full app uninstall removes `optional-loaders/`.
- App updates do not remove optional packs automatically.

## Settings UI

Settings should include an `Optional Loader Packs` section. It should be the
main management surface for first-party packs.

Initial UI:

- Show each known pack: `Installed`, `Missing`, `Disabled`, `Version`, and
  supported extensions.
- Offer `Enable` / `Disable` for installed packs.
- Offer `Install` for missing first-party packs when a pack source is
  configured.
- Offer `Remove` only after a confirmation step.
- Show compatibility warnings without blocking core loaders.

The pack section should also explain why a pack is optional through concise
labels, not a long help block: smaller startup surface, fewer file
associations, and install only what is needed.

## Viewport UI

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

## Extension Registration

File associations should respect enabled packs:

- Core extensions follow the normal file-association setting.
- Optional extensions are registered only when their pack is installed and
  enabled.
- Disabling or removing a pack should remove its optional extension
  registrations on the next association sync.
- The Settings UI should make this relationship visible because it is one of
  the reasons optional packs exist.

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
3. Add manifest scan and validation from the app-managed pack directory.
4. Add Settings read-only reporting for known packs.
5. Add Settings enable/disable state and make loader registration respect it.
6. Make file association sync respect enabled optional packs.
7. Add Settings install/remove for first-party packs.
8. Wire NSIS Custom Install sections to seed selected pack directories.
9. Implement VRM (#70) and MMD (#71) as first-party packs behind the registry.
10. Add pack version and compatibility reporting in Settings / Diagnostics.
