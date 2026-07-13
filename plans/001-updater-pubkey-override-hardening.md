# Plan 001: Gate the updater public-key override so it cannot silently replace signature verification

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96a931e..HEAD -- src-tauri/src/commands/updater.rs src-tauri/src/commands/settings.rs src-tauri/src/shared.rs`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
> Note: at planning time `src-tauri/src/commands/settings.rs` had a small
> uncommitted working-tree change (+9 lines, NSIS-loader-pack related). The
> excerpts below were taken from the working tree, not from `96a931e`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `96a931e`, 2026-07-13

## Why this matters

yw-look has an in-app updater that downloads installers from GitHub Releases and
verifies them against a minisign public key compiled into the app. However,
`AppSettings.update_public_key_override` — writable from the webview via the
`save_settings` IPC command — is preferred over the compiled-in key with **no
gating at all**. The endpoint override at least requires `https://` (or an
explicit insecure toggle restricted to loopback), but the pubkey override has
no equivalent restriction. Any code that can call `invoke("save_settings", …)`
(a supply-chain-compromised frontend dependency, or a future XSS-class bug in
metadata rendering) can swap in an attacker key plus an attacker HTTPS endpoint,
and the next update check will download, "verify", and execute an attacker
installer with full user privileges. The override exists to support local
update-feed testing (`npm run update:local:serve` + Settings UI fields), so the
fix is to gate it to that scenario — effective only together with
`allow_insecure_update_endpoint` and a loopback endpoint — not to remove it.

## Current state

- `src-tauri/src/commands/updater.rs` — updater IPC commands. Contains the
  ungated override resolution:

  ```rust
  // updater.rs:69-81
  fn effective_updater_endpoint(settings: &AppSettings) -> Option<String> {
      settings
          .update_endpoint_override
          .clone()
          .or_else(default_updater_endpoint)
  }

  fn effective_updater_public_key(settings: &AppSettings) -> Option<String> {
      settings
          .update_public_key_override
          .clone()
          .or_else(default_updater_public_key)
  }
  ```

  ```rust
  // updater.rs:83-87
  fn is_loopback_update_endpoint(endpoint: &str) -> bool {
      endpoint.starts_with("http://127.0.0.1")
          || endpoint.starts_with("http://localhost")
          || endpoint.starts_with("http://[::1]")
  }
  ```

  `build_updater` (updater.rs:121-155) already enforces, for the **endpoint**:
  plain `http://` requires `allow_insecure_update_endpoint`, and when that
  toggle is on the endpoint must be loopback. The **pubkey** override passes
  through with no checks.

- `src-tauri/src/commands/updater.rs:89-108` —
  `build_update_configuration_payload` reports `using_override_pubkey:
settings.update_public_key_override.is_some()` and
  `effective_pubkey_available` to the Settings UI.

- `src-tauri/src/shared.rs:228-244` — `sanitize_settings` only trims
  whitespace on both overrides (`normalize_optional_text`). No validation.

- `src-tauri/src/commands/settings.rs:96-108` — `save_settings` IPC accepts a
  full `AppSettings` from the frontend and persists it after
  `sanitize_settings`. This is the webview-reachable write path.

- Frontend: `src/app/useSettingsActions.ts:110-136`
  (`handleSaveUpdateSettings`) writes `updateEndpointOverride`,
  `updatePublicKeyOverride`, `allowInsecureUpdateEndpoint` from the Settings
  UI. This is a legitimate developer feature for local update-feed testing
  (see `scripts/serve-local-update-feed.mjs`, `npm run smoke:update-feed`).

- Test conventions: Rust unit tests live in `#[cfg(test)] mod tests` at the
  bottom of the same file — see `src-tauri/src/commands/settings.rs:118-277`
  for the exemplar style (plain `#[test]` fns, `tempfile::tempdir()` where fs
  is needed, `expect("...")` messages). `updater.rs` currently has **zero**
  tests.

- Repo quirk: `cargo` commands must run in a local session, not over SSH
  (Windows OpenSSH blocks them on this machine).

## Commands you will need

| Purpose            | Command                                                                                                       | Expected on success |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------- |
| Rust typecheck     | `npm run typecheck:rust`                                                                                      | exit 0              |
| Rust tests         | `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features backend-openusd-rs updater` | all pass            |
| IPC type freshness | `npm run check:ipc-types`                                                                                     | exit 0              |
| Format             | `npm run format:check`                                                                                        | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `src-tauri/src/commands/updater.rs`

**Out of scope** (do NOT touch, even though they look related):

- `src-tauri/src/commands/settings.rs` / `src-tauri/src/shared.rs` — keep
  `sanitize_settings` as-is; the gate belongs at the point of use so stored
  settings stay round-trippable and the Settings UI keeps showing what the
  user typed. Also, settings.rs has unrelated uncommitted WIP.
- `src/app/useSettingsActions.ts`, `src/components/SettingsCard.tsx` — no UI
  change in this plan. UI messaging is deferred (see Maintenance notes).
- `src/types/generated/ipc.ts` — regenerated only; never hand-edit.
- The payload struct shape in `UpdateConfigurationPayload` — do not add or
  remove fields (frontend types depend on it); only the _values_ of
  `effective_pubkey_available` / `using_override_pubkey` may change meaning as
  described in Step 2.

## Git workflow

- Repo is in alpha mode: commits go directly to `develop`; do NOT push.
- One commit for this plan. Message style is short imperative, e.g.
  `Gate updater pubkey override to loopback testing` (match `git log
--oneline` style: "Use Radix icons for app controls").

## Steps

### Step 1: Introduce a gated resolution function for the pubkey override

In `src-tauri/src/commands/updater.rs`, add a pure helper that decides whether
the pubkey override may take effect, and route
`effective_updater_public_key` through it:

```rust
/// The pubkey override exists only for local update-feed testing. It takes
/// effect solely when the insecure-endpoint toggle is on AND the effective
/// endpoint is loopback — the same conditions build_updater already imposes
/// on insecure endpoints. In every other configuration the compiled-in key
/// wins, so a webview-writable setting can never replace release signature
/// verification.
fn pubkey_override_permitted(settings: &AppSettings) -> bool {
    settings.allow_insecure_update_endpoint
        && effective_updater_endpoint(settings)
            .as_deref()
            .is_some_and(is_loopback_update_endpoint)
}

fn effective_updater_public_key(settings: &AppSettings) -> Option<String> {
    settings
        .update_public_key_override
        .clone()
        .filter(|_| pubkey_override_permitted(settings))
        .or_else(default_updater_public_key)
}
```

Keep `effective_updater_endpoint` unchanged. Do not change `build_updater`'s
existing endpoint checks.

**Verify**: `npm run typecheck:rust` → exit 0

### Step 2: Make the configuration payload reflect the gate

In `build_update_configuration_payload` (updater.rs:89-108), change
`using_override_pubkey` to report whether the override is **in effect**, not
merely present:

```rust
using_override_pubkey: settings.update_public_key_override.is_some()
    && pubkey_override_permitted(settings),
```

`effective_pubkey_available` already derives from
`effective_updater_public_key` and needs no change.

**Verify**: `npm run typecheck:rust` → exit 0, and
`npm run check:ipc-types` → exit 0 (payload shape unchanged, so generated TS
must not change).

### Step 3: Add the missing unit tests for updater endpoint/pubkey logic

Add `#[cfg(test)] mod tests` at the bottom of `updater.rs`, modeled on the
test style in `src-tauri/src/commands/settings.rs:118-277`. `AppSettings`
implements `Default`; build test settings with struct-update syntax
(`AppSettings { update_public_key_override: Some(...), ..AppSettings::default() }`).
Cover at least:

1. `is_loopback_update_endpoint`: true for `http://127.0.0.1:8080/x`,
   `http://localhost:9000/latest.json`, `http://[::1]/f`; false for
   `https://github.com/...`, `http://192.168.1.5/`, `http://evil.example/`.
2. `effective_updater_public_key` returns the **default** key when an override
   is set but `allow_insecure_update_endpoint` is false.
3. `effective_updater_public_key` returns the default key when the toggle is
   on but the effective endpoint is non-loopback (e.g. override endpoint
   `https://attacker.example/latest.json`).
4. `effective_updater_public_key` returns the **override** when the toggle is
   on and the endpoint override is `http://127.0.0.1:1430/latest.json`.
5. `build_update_configuration_payload` reports
   `using_override_pubkey == false` for case 2 and `true` for case 4.
   (`build_update_configuration_payload` takes `&tauri::AppHandle` — if that
   makes it untestable without an app, extract the payload construction into a
   pure fn taking `current_version: String` + `&AppSettings`, and have the
   existing fn delegate to it. Keep the public surface identical.)

Note: cases 2/3 depend on `DEFAULT_UPDATER_PUBLIC_KEY` being non-empty at
compile time. Check how that constant is defined in `src-tauri/src/shared.rs`;
if it is `None`/empty in dev builds, assert `None` is returned instead — the
security property under test is "the override is ignored", i.e. the result
must NOT equal the override value.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features backend-openusd-rs updater`
→ all new tests pass.

## Test plan

Covered by Step 3 (unit tests in `updater.rs`). No frontend tests needed —
frontend behavior is unchanged. Full gate: `npm run typecheck` and the cargo
test filter above.

## Done criteria

- [ ] `npm run typecheck:rust` exits 0
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features backend-openusd-rs updater` exits 0 with ≥6 new tests
- [ ] `npm run check:ipc-types` exits 0
- [ ] `npm run format:check` exits 0
- [ ] With default settings + a pubkey override set, `effective_updater_public_key` returns the compiled-in default (asserted by a test)
- [ ] Only `src-tauri/src/commands/updater.rs` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" no longer match `updater.rs` (e.g. someone
  already added gating or restructured `effective_updater_*`).
- You find a script or test that programmatically sets
  `update_public_key_override` together with a **non-loopback** endpoint
  (search: `grep -rn "updatePublicKeyOverride\|update_public_key_override" scripts/ src/ src-tauri/`)
  — that would mean a real workflow depends on the ungated behavior and the
  gate design needs owner sign-off. (At planning time the only writers were
  the Settings UI and tests using `null`.)
- `check:ipc-types` fails after Step 2 — that means the payload derive setup
  differs from the plan's assumption; report instead of regenerating blindly.

## Maintenance notes

- Follow-up (deferred): the Settings UI should tell the user when a pubkey
  override is present but inactive (`using_override_pubkey == false` while the
  field is non-empty). That is a UI-copy decision for the owner.
- Reviewer should scrutinize: that `pubkey_override_permitted` uses the
  **effective** endpoint (override or default), not just the override — a
  default HTTPS GitHub endpoint plus toggle-on must NOT enable the pubkey
  override (the loopback check guarantees this).
- If a future plan adds channel/beta update feeds, the gate must be revisited
  so production channels can never combine with an overridden key.
