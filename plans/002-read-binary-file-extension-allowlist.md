# Plan 002: Add an asset-extension allowlist to the raw binary-read IPC commands

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96a931e..HEAD -- src-tauri/src/commands/files.rs src-tauri/src/shared.rs src/formatSupport.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S/M
- **Risk**: MED (an over-narrow allowlist breaks texture/sidecar loading — the sidecar list below is the load-bearing part of this plan)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `96a931e`, 2026-07-13

## Why this matters

`read_binary_file` and `read_binary_file_prefix` are Tauri IPC commands that
return the raw bytes of **any** path the webview asks for. Unlike their sibling
commands in the same file (`build_selected_file_payload`,
`build_asset_inspection`), they perform no extension check — only
`normalize_file_path`, which merely requires the path to exist and be a file.
If the webview is ever compromised (supply-chain in a frontend dependency, or
an XSS-class bug), these two commands turn it into arbitrary local file read —
SSH keys, browser cookie DBs, credential files — instead of just CG assets.
Adding the same extension gating the sibling commands already use closes this
gap at near-zero cost. The subtlety: the frontend legitimately reads **sidecar
files whose extensions are NOT in the supported-format manifest** (glTF `.bin`
buffers, MMD `.bmp`/`.sph`/`.spa` toon and sphere textures), so the allowlist
must be `is_supported_extension` **plus** an explicit sidecar list, or real
assets will stop loading.

## Current state

- `src-tauri/src/commands/files.rs:463-488` — the two ungated commands:

  ```rust
  #[tauri::command]
  pub(crate) fn read_binary_file(path: String) -> Result<tauri::ipc::Response, AppError> {
      let normalized = normalize_file_path(PathBuf::from(path))?;
      let bytes = fs::read(normalized)
          .map_err(|error| AppError::Io(format!("failed to read file bytes: {error}")))?;
      // ...comment about ArrayBuffer...
      Ok(tauri::ipc::Response::new(bytes))
  }

  #[tauri::command]
  pub(crate) fn read_binary_file_prefix(
      path: String,
      max_bytes: usize,
  ) -> Result<tauri::ipc::Response, AppError> {
      let normalized = normalize_file_path(PathBuf::from(path))?;
      // ...take(max_bytes)...
  }
  ```

- `src-tauri/src/shared.rs:120-124` — the existing allowlist helper used by
  sibling commands:

  ```rust
  pub(crate) fn is_supported_extension(extension: &str) -> bool {
      extension_in_list(extension, model_extensions())
          || extension_in_list(extension, texture_extensions())
          || extension_in_list(extension, motion_extensions())
  }
  ```

  The lists come from `src/formatSupport.json` (embedded as the format-support
  manifest): model = glb, gltf, fbx, obj, ply, stl, usd, usda, usdc, usdz,
  dae, vrm, abc, pmx, pmd, splat, spz, ksplat, sog; texture = png, jpg, jpeg,
  tga, dds, ktx2, hdr, exr; motion = vmd.

- `src-tauri/src/shared.rs:126-143` — `normalize_file_path` (exists + is_file
  - canonicalize). No extension logic.

- **Frontend callers of these commands** (via `src/lib/files.ts:155-170`
  wrappers `readBinaryFile` / `readBinaryFilePrefix`) and the extensions they
  actually request — this is the ground truth the allowlist must cover:
  - Model loaders read the model file itself (extensions all in `model`):
    `src/viewer/{gltf,fbx,obj,ply,stl,dae,usd}/loader.ts`,
    `src/packs/{vrm-loader-pack,mmd-loader-pack,gaussian-splat-loader-pack}`,
    `src/viewer/prefetchCache.ts:62`, `src/lib/usd.ts:284,299,328`,
    `src/bench/benchRuntime.ts:109`.
  - **Sidecar reads with extensions NOT in the manifest**:
    - glTF external buffers: `.bin` (read via `createBlobUrlFromPath` in
      `src/viewer/gltf/loader.ts`).
    - MMD textures referenced by PMX/PMD materials: `.bmp`, `.sph`, `.spa`
      (toon/sphere maps; loaded through the MMD pack's file-reading path).
    - OBJ/DAE sibling texture probing: `src/viewer/obj/loader.ts:98-104`
      (`pathExists` calls `readBinaryFilePrefix(path, 1)`) and
      `src/viewer/dae/loader.ts` — these probe _texture candidate_ paths, so
      texture extensions + `.bmp` must pass.
    - MMD also supports plain `.vrma`? No — `.vrma` is VRM animation; check
      whether the VRM pack reads `.vrma` via `readBinaryFile`
      (`grep -rn "vrma" src/packs/vrm-loader-pack/`). If yes, include it.

- Test conventions: `files.rs` has `#[cfg(test)] mod tests` already (grep for
  `mod tests` in the file); frontend IPC wrapper tests live in
  `src/lib/__tests__/files.test.ts` with a mocked `invoke`.

- Repo quirk: `cargo` must run in a local session, not over SSH.

## Commands you will need

| Purpose                            | Command                                                                                                     | Expected on success    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| Rust typecheck                     | `npm run typecheck:rust`                                                                                    | exit 0                 |
| Rust tests                         | `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features backend-openusd-rs files` | all pass               |
| Frontend tests                     | `npx vitest run src/lib/__tests__/files.test.ts`                                                            | all pass               |
| Fixture regression (the real gate) | `npm run test:fixtures`                                                                                     | all catalog cases pass |
| Full check                         | `npm run check`                                                                                             | exit 0                 |

## Scope

**In scope** (the only files you should modify):

- `src-tauri/src/commands/files.rs`
- `src-tauri/src/shared.rs` (new helper + sidecar list only)

**Out of scope** (do NOT touch):

- `src/formatSupport.json` — that manifest drives dialogs/associations for
  _openable_ formats; sidecar extensions (`bin`, `bmp`, …) must NOT be added
  there or they'd appear as openable file types in the UI.
- `src/lib/files.ts` and all frontend loaders — no frontend change.
- `normalize_file_path` itself — other commands rely on its current contract.

## Git workflow

- Alpha mode: commit directly to `develop`; do NOT push. One commit, message
  like `Restrict raw binary reads to asset extensions`.

## Steps

### Step 1: Add the sidecar-aware allowlist helper

In `src-tauri/src/shared.rs`, next to `is_supported_extension`, add:

```rust
/// Extensions readable by the raw byte-read IPC commands. Wider than
/// `is_supported_extension` because loaders fetch sidecar files that are not
/// themselves openable formats: glTF external buffers (`bin`), MMD toon and
/// sphere textures (`bmp`, `sph`, `spa`). Keep this list in sync with the
/// frontend loader sidecar reads — see plans/002 for the caller inventory.
const SIDECAR_READ_EXTENSIONS: &[&str] = &["bin", "bmp", "sph", "spa"];

pub(crate) fn is_readable_asset_extension(extension: &str) -> bool {
    let lowered = extension.to_ascii_lowercase();
    is_supported_extension(&lowered)
        || SIDECAR_READ_EXTENSIONS.contains(&lowered.as_str())
}
```

Check how `extension_in_list` handles case (read it in `shared.rs`); if it
already lowercases, mirror that behavior — the comparison must be
case-insensitive either way (`Texture.PNG` on Windows is common). Extend the
list with `vrma` if the grep in "Current state" showed the VRM pack reads
`.vrma` through `readBinaryFile`.

**Verify**: `npm run typecheck:rust` → exit 0

### Step 2: Gate both commands

In `src-tauri/src/commands/files.rs`, at the top of both `read_binary_file`
and `read_binary_file_prefix`, after `normalize_file_path`, reject paths whose
extension is missing or not allowed:

```rust
let extension = normalized
    .extension()
    .and_then(|ext| ext.to_str())
    .unwrap_or_default();
if !is_readable_asset_extension(extension) {
    return Err(AppError::Io(format!(
        "refusing to read unsupported file type: {}",
        normalized.display()
    )));
}
```

Use the same `AppError` variant style as the surrounding errors in the file
(they use `AppError::Io(...)` — match it). Import the helper alongside the
existing `shared::` imports.

**Verify**: `npm run typecheck:rust` → exit 0

### Step 3: Unit tests

In `files.rs`'s existing `#[cfg(test)] mod tests` (create one at the bottom if
none covers these commands — follow the style of
`src-tauri/src/commands/settings.rs:118-277`, using `tempfile::tempdir()`):

1. `read_binary_file` on a temp `model.glb` (any bytes) → Ok, returns bytes.
2. `read_binary_file` on a temp `texture.PNG` (uppercase) → Ok
   (case-insensitivity).
3. `read_binary_file` on temp `buffer.bin`, `toon.bmp`, `sphere.sph`,
   `sphere.spa` → Ok (sidecar list).
4. `read_binary_file` on temp `secrets.txt` and on `id_rsa` (no extension) →
   Err, message contains "unsupported file type".
5. Same rejection cases for `read_binary_file_prefix`.

If the command fns can't be called directly in tests because of the
`tauri::ipc::Response` return type, extract the body into
`fn read_binary_file_impl(path: String) -> Result<Vec<u8>, AppError>` (and a
prefix variant) and test those; the `#[tauri::command]` wrappers just wrap the
result in `Response::new`.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features backend-openusd-rs files`
→ all pass, including the new cases.

### Step 4: Regression-gate against real assets

Run the fixture regression catalog — this is what proves the allowlist didn't
break a real loader path (external glTF buffers/textures, MMD toon textures,
OBJ/MTL texture probing):

**Verify**: `npm run test:fixtures` → all cases pass. If any case fails with a
"refusing to read unsupported file type" error, note the extension it needed —
that is a missing sidecar entry; add it to `SIDECAR_READ_EXTENSIONS` with a
comment naming the fixture, and re-run. If the failure is anything other than
a missing extension, STOP.

## Test plan

Steps 3–4 above. Structural pattern for Rust tests:
`src-tauri/src/commands/settings.rs` test module. Final gate: `npm run check`.

## Done criteria

- [ ] `npm run typecheck:rust` exits 0
- [ ] New unit tests pass (Step 3 filter command exits 0)
- [ ] `npm run test:fixtures` exits 0
- [ ] `npm run check` exits 0
- [ ] Reading a `.txt` path via `read_binary_file` returns Err (asserted by test)
- [ ] Only `files.rs` and `shared.rs` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The excerpts no longer match (someone already gated these commands).
- `npm run test:fixtures` fails for a reason other than a missing sidecar
  extension (see Step 4).
- You find a frontend caller reading an extension that feels wrong to
  allowlist globally (e.g. `.json`, `.txt`, or extensionless files) — that
  requires a design decision (per-caller scoping), not a bigger list. At
  planning time no such caller existed; USD/Alembic sidecars go through the
  Rust backends, not these commands.
- Gaussian-splat pack: `.ply` is in the model list so covered, but if its
  loader reads `.sog` bundles as _directories_ or companion files with other
  extensions, and a fixture fails on it, report rather than widen.

## Maintenance notes

- Any future loader that reads a new sidecar type via `readBinaryFile` must
  extend `SIDECAR_READ_EXTENSIONS` — the fixture suite will catch it if the
  fixture exists; when adding such a loader, add a fixture that exercises the
  sidecar read.
- Reviewer should scrutinize the sidecar list against
  `grep -rn "readBinaryFile\|readBinaryFilePrefix" src/` output — the list, not
  the gating code, is where this plan can silently break assets.
- Deferred (out of scope): scoping reads to session-approved directories
  (e.g. only under directories the user actually opened) would be a stronger
  boundary; consider after the error-experience (B1–B8) work lands.
