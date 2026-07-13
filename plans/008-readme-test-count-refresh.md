# Plan 008: Refresh the stale README test counts and guard them with a check

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96a931e..HEAD -- README.md scripts/count-tests.mjs`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `96a931e`, 2026-07-13

## Why this matters

`README.md` states its test counts are generated (`件数は npm run test:count で
生成している`), but the committed numbers are ~3x stale: the badge says 314
tests and the table says 39 files / 314 cases / 216 frontend / 98 Rust / 14
fixtures, while `node scripts/count-tests.mjs` today reports 133 files / 951
cases / 666 frontend / 285 Rust / 35 fixture assets / 37 catalog cases. A
reader trusting the badge undercounts real coverage threefold, and nothing
stops it drifting further. This is a small, safe docs fix plus a guard so it
can't silently rot again.

## Current state

- `README.md:5` — badge `![Tests](https://img.shields.io/badge/tests-314-brightgreen)`.
- `README.md:47-58` — the QA table. Current committed rows (all stale):
  - テストファイル 39, テストケース 314, フロントエンドのテストケース 216,
    Rust のテストケース 98, Fixture アセット 14, Fixture カタログケース 14,
    対応 3D フォーマット 7, 対応画像フォーマット 7.
  - Line 58: "件数は `npm run test:count` で生成している。..."
- `scripts/count-tests.mjs` — the counting script. It is **read-only** (it
  prints counts; it does not write the README). Current output labels:
  `Test files`, `Test cases`, `Frontend test files`, `Frontend test cases`,
  `Rust test files`, `Rust test cases`, `Fixture assets`, `Fixture catalog
cases`. Today's values: 133 / 951 / 100 / 666 / 33 / 285 / 35 / 37.
- Format counts (対応 3D 7 / 対応画像 7) come from `src/formatSupport.json`
  (`model`/`texture` arrays) but the README's "7 / 7" predates VRM/MMD/splat
  additions to the manifest — treat these two rows carefully (see Step 1).
- The badge/table were last touched in `a512730` (2026-05-31).

## Commands you will need

| Purpose           | Command                                             | Expected on success         |
| ----------------- | --------------------------------------------------- | --------------------------- |
| Regenerate counts | `node scripts/count-tests.mjs`                      | prints the 8 current values |
| The new check     | `node scripts/count-tests.mjs --check` (see Step 3) | exit 0 when README matches  |
| Format check      | `npm run format:check`                              | exit 0                      |

## Scope

**In scope**:

- `README.md` (badge + table numbers)
- `scripts/count-tests.mjs` (add a `--check` mode)
- `package.json` (optional: wire a `check:test-count` script — see Step 3)

**Out of scope**:

- Changing what counts as a test / how counting works.
- The prose around the table beyond the numbers.
- The format-count rows IF you cannot establish the correct intended number
  (see Step 1 — leave them rather than guess).

## Git workflow

- Alpha mode: commit directly to `develop`; do NOT push. One commit, e.g.
  `Refresh README test counts and add a drift check`.

## Steps

### Step 1: Regenerate and update the numbers

Run `node scripts/count-tests.mjs`, then update `README.md`:

- Badge (line 5): `tests-314` → `tests-<current Test cases>` (today: 951).
- Table (lines 48-56): update テストファイル, テストケース,
  フロントエンドのテストケース, Rust のテストケース, Fixture アセット,
  Fixture カタログケース to the script's current values.
- The two format rows (対応 3D フォーマット / 対応画像フォーマット): the
  README currently says 7/7. `src/formatSupport.json` `texture` has 8 entries
  (png,jpg,jpeg,tga,dds,ktx2,hdr,exr) and `model` has 19 (incl. optional-pack
  formats). These rows count _core_ formats, not manifest length, so they are
  NOT mechanically derivable from the manifest. LEAVE these two rows unchanged
  unless `count-tests.mjs` (or another script) actually emits them — it does
  not today. Note this in the completion report.

**Verify**: the six count rows + badge match `node scripts/count-tests.mjs`
output exactly.

### Step 2: (no code) sanity-read

Confirm no other place in README repeats the old counts (search README for
`314`, `216`, `98`). Update any stragglers.

**Verify**: `grep -n "314\|-216-\|tests-" README.md` shows only the refreshed
badge/table.

### Step 3: Add a `--check` mode to the counter

Extend `scripts/count-tests.mjs` with a `--check` flag: when passed, it
computes the counts, reads `README.md`, and exits non-zero (printing the
mismatched fields) if the badge or any of the six count rows disagree with the
freshly computed values. Keep the default (no-flag) behavior — printing the
table — unchanged. Add to `package.json`:

- `"check:test-count": "node scripts/count-tests.mjs --check"`

Decide with the operator's existing conventions whether to add it to the main
`check` chain. Recommended: add it, since README is the one user-facing doc and
the check is fast and offline. Append `&& npm run check:test-count` to the
`check` script.

**Verify**: `node scripts/count-tests.mjs --check` → exit 0 after Step 1's
edits. Change one README number by hand and confirm it exits non-zero, then
revert.

### Step 4: Full gate

**Verify**: `npm run format:check` → exit 0. If you added it to the chain,
`npm run check:test-count` → exit 0.

## Test plan

The `--check` mode IS the guard. No unit test; verify both exit states
manually per Step 3.

## Done criteria

- [ ] README badge and the six count rows match `node scripts/count-tests.mjs`
- [ ] `scripts/count-tests.mjs --check` exits 0 on match, non-zero on mismatch (both verified)
- [ ] `check:test-count` script exists; (if added) `npm run check` runs it
- [ ] Format-count rows either correctly updated or explicitly left with a note
- [ ] `npm run format:check` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `count-tests.mjs`'s output labels differ from those in "Current state" (the
  script changed) — re-map before editing README.
- Adding `--check` would require parsing README in a brittle way (e.g. the
  numbers aren't uniquely locatable) — report and propose a machine-readable
  marker (HTML comment anchors) instead of guessing.

## Maintenance notes

- With `check:test-count` in CI/`check`, adding tests now requires refreshing
  the README numbers (or the check fails) — that's the intended forcing
  function; keep the check fast so it's not resented.
- Reviewer: the format-count rows are a known soft spot — if the product later
  emits a canonical "core formats" count, fold those rows into the check too.
