# Plan 007: Re-vendor FBXLoaderPatched against the installed three, and add a drift check

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96a931e..HEAD -- src/vendor/ package.json scripts/`
> If `src/vendor/FBXLoaderPatched.js` or the pinned `three` version changed
> since this plan was written, re-read "Current state" against the live files
> before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (FBX import path; guarded by fixture regression)
- **Depends on**: none
- **Category**: dependency / migration
- **Planned at**: commit `96a931e`, 2026-07-13

## Why this matters

`src/vendor/FBXLoaderPatched.js` is a fork of three.js's `FBXLoader` carrying
two local patches. Its header says it was vendored from **three 0.179.1**, but
`package.json` pins `"three": "^0.180.0"` (installed: 0.180.0) — the fork is
already snapshotted from an older three than the app runs, and the gap will
grow on every future three bump. Upstream FBX fixes (including correctness fixes
to parsing of untrusted `.fbx` files, which this app opens as its core job)
never reach the fork unless someone manually re-diffs it, and nothing detects
the drift. This plan re-vendors against the currently installed three, re-applies
the two documented patches, and adds a lightweight check that fails when the
header's snapshot version no longer matches the installed three.

## Current state

- `src/vendor/FBXLoaderPatched.js` (4415 lines). Header documents provenance
  and the two local patches:

  ```js
  // Vendored from three/examples/jsm/loaders/FBXLoader.js in three 0.179.1.
  // Local changes:
  // - Resolve relative helper imports through the three package so this file can
  //   live under src/vendor.
  // - Ignore AnimationCurve connections whose parent AnimationCurveNode was
  //   intentionally filtered out by parseAnimationCurveNodes(). Amazon
  //   Lumberyard Bistro Exterior v5.2 contains such curves; upstream FBXLoader
  //   otherwise dereferences an undefined curve node and aborts the load.
  ```

  - **Patch 1 (imports)**: upstream uses relative imports for helpers (e.g.
    `../curves/NURBSCurve.js`, `../libs/fflate.module.js`); the fork rewrites
    them to import through the `three` package so the file works under
    `src/vendor/`. You will re-apply this by diffing the import block.
  - **Patch 2 (filtered animation curves)**: in `parseAnimationCurveNodes()` /
    the curve-connection wiring, the fork skips `AnimationCurve` connections
    whose parent `AnimationCurveNode` was filtered out (guards an
    undefined-deref that upstream hits on Bistro Exterior v5.2). Find this by
    diffing the fork against upstream 0.179.1 (see Step 1).

- Installed upstream to diff against:
  `node_modules/three/examples/jsm/loaders/FBXLoader.js` (present; matches the
  installed three 0.180.0).
- `src/vendor/FBXLoaderPatched.d.ts` — hand-written type stub; likely needs no
  change unless the upstream public API changed (it did not between 0.179→0.180
  for `FBXLoader`; verify).
- Importers (do not change): `src/workers/modelParse.worker.ts:16`,
  `src/selftest.ts:266`, `src/viewer/fbx/loader.ts:1134`,
  `src/viewer/fbx/__tests__/loader.test.ts:12`.
- `three` version source of truth: `package.json` `dependencies.three`
  (`^0.180.0`); installed version readable from
  `node_modules/three/build/three.module.js` header or
  `node_modules/three/package.json` `"version"` field (grep it — the package's
  `exports` block blocks `require('three/package.json')`, so read the file
  directly, don't `require` it).
- Scripts convention: repo check scripts are Node ESM `.mjs` under `scripts/`,
  wired as `check:*` npm scripts (see `package.json` scripts and e.g.
  `scripts/check-file-associations.mjs` for style). WIP note: FBX loader code
  (`src/viewer/fbx/loader.ts`) has uncommitted worker-offload changes, but the
  **vendored file itself** is not part of that WIP — still, coordinate: do not
  reformat the whole vendored file (keep it a clean upstream+patches diff).

## Commands you will need

| Purpose                              | Command                                                                                                   | Expected on success                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Diff fork vs upstream                | `git diff --no-index node_modules/three/examples/jsm/loaders/FBXLoader.js src/vendor/FBXLoaderPatched.js` | shows the 2 patch regions + import rewrites |
| FBX loader unit tests                | `npx vitest run src/viewer/fbx`                                                                           | all pass                                    |
| Fixture regression (real FBX assets) | `npm run test:fixtures`                                                                                   | all catalog cases pass                      |
| The new drift check                  | `node scripts/check-vendored-three.mjs`                                                                   | exit 0                                      |
| Typecheck                            | `npm run typecheck:ts`                                                                                    | exit 0                                      |
| Full check                           | `npm run check`                                                                                           | exit 0                                      |

## Scope

**In scope**:

- `src/vendor/FBXLoaderPatched.js` (re-vendor)
- `src/vendor/FBXLoaderPatched.d.ts` (only if upstream API changed)
- `scripts/check-vendored-three.mjs` (create)
- `package.json` (add a `check:vendored-three` script; add it to the `check`
  chain)

**Out of scope**:

- Bumping the `three` dependency version — this plan syncs the fork to the
  _currently installed_ three, it does NOT upgrade three. A three upgrade is a
  separate decision.
- FBX loader logic in `src/viewer/fbx/` — active WIP; don't touch.
- Any import site of the vendored file.

## Git workflow

- Alpha mode: commit directly to `develop`; do NOT push. One commit, e.g.
  `Re-vendor FBXLoader against three 0.180 and add drift check`.

## Steps

### Step 1: Capture the current patch set as a diff

Produce and save (to your scratch space, not the repo) the diff between the
installed upstream and the current fork:

`git diff --no-index node_modules/three/examples/jsm/loaders/FBXLoader.js src/vendor/FBXLoaderPatched.js`

Since upstream here is 0.180.0 and the fork is from 0.179.1, this diff contains
BOTH the intended patches AND any 0.179→0.180 upstream drift mixed together.
To separate them, if feasible also fetch the 0.179.1 upstream for a clean
patch extraction (e.g. from the `three@0.179.1` package tarball via
`npm pack three@0.179.1` into scratch, or the three GitHub tag). Identify
precisely the two patch regions (import rewrites; filtered-curve guard). If you
cannot obtain 0.179.1 cleanly, proceed by manual identification: the import
block is obvious, and the filtered-curve guard is a localized conditional in
the animation-curve wiring — grep the fork for the Bistro/undefined-curve guard
comment and surrounding `if` to locate it.

**Verify**: you can state exactly which line ranges in the fork are Patch 1 and
Patch 2. (No command gate; this is analysis.)

### Step 2: Re-vendor

Copy `node_modules/three/examples/jsm/loaders/FBXLoader.js` (0.180.0) to
`src/vendor/FBXLoaderPatched.js`, then re-apply:

- **Patch 1**: rewrite the relative helper imports to import through the
  `three` package, exactly as the old fork did (copy the import block from the
  saved old version if the helper set is unchanged; adjust if 0.180 added/moved
  a helper import).
- **Patch 2**: re-apply the filtered-animation-curve guard in the same
  logical location in 0.180's code (the function may have shifted lines; apply
  by semantics, not line number).
- Update the header comment: change `three 0.179.1` → the installed version
  (`three 0.180.0`), keep the two "Local changes" bullets.

Keep the file otherwise byte-identical to upstream 0.180 — do NOT run prettier
over it (it's vendored; a full reformat destroys the upstream diff). If the
repo's `format:check` would flag it, add it to prettier ignore
(`.prettierignore`) rather than reformatting — check whether `src/vendor/` is
already ignored; if `format:check` currently passes on the fork, matching
upstream style should keep passing.

**Verify**: `npx vitest run src/viewer/fbx` → all pass; `npm run typecheck:ts`
→ exit 0.

### Step 3: Prove the patches still work on real assets

The filtered-curve patch exists because a real asset (Lumberyard Bistro
Exterior) breaks without it. Run the fixture regression:

**Verify**: `npm run test:fixtures` → all cases pass. If a Bistro/FBX case now
fails with an undefined-curve error, Patch 2 was mis-applied — revisit Step 2.
If no FBX-with-filtered-curves fixture exists in the public catalog, note that
in the completion report (the patch is then only guarded by intent, not a
fixture) and do NOT invent one.

### Step 4: Add the drift check

Create `scripts/check-vendored-three.mjs` (Node ESM, style per
`scripts/check-file-associations.mjs`): read the installed three version (read
`node_modules/three/package.json` as text and parse, since `exports` blocks
subpath require), read the `// Vendored from three/... in three X.Y.Z.` version
from `src/vendor/FBXLoaderPatched.js`'s header, and exit non-zero with a clear
message if they differ. Wire it into `package.json`:

- add `"check:vendored-three": "node scripts/check-vendored-three.mjs"`
- append `&& npm run check:vendored-three` to the `"check"` script chain
  (after the existing boundary checks, before or with the other `check:*` —
  match the existing chaining style in the `check` script).

**Verify**: `node scripts/check-vendored-three.mjs` → exit 0 (versions now
match). Temporarily edit the header to a wrong version and confirm it exits
non-zero, then revert.

### Step 5: Full gate

**Verify**: `npm run check` → exit 0.

## Test plan

- Existing FBX unit tests (`src/viewer/fbx`) and fixture regression
  (`test:fixtures`) are the behavioral gate — no new unit test for the vendored
  file itself (it's upstream code).
- The new `check:vendored-three` is itself the regression guard against future
  drift.

## Done criteria

- [ ] `src/vendor/FBXLoaderPatched.js` header states the installed three version (0.180.0)
- [ ] Both documented patches are present and identifiable in the diff vs upstream
- [ ] `npx vitest run src/viewer/fbx` and `npm run test:fixtures` pass
- [ ] `scripts/check-vendored-three.mjs` exists, exits 0 on match, non-zero on mismatch (both states verified)
- [ ] `check:vendored-three` is in the `check` chain (`npm run check` runs it)
- [ ] `npm run check` exits 0
- [ ] `three` dependency version in package.json UNCHANGED (`git diff package.json` shows only the two script additions)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The 0.179→0.180 upstream diff is large enough that you cannot confidently
  separate upstream changes from the two intended patches — report it and ask
  for the 0.179.1 baseline rather than guessing which lines are "the patch".
- Re-applying Patch 2 is ambiguous because the animation-curve code was
  restructured upstream between 0.179 and 0.180 — report where the guard used
  to sit and what changed.
- `npm run test:fixtures` fails on a non-FBX case (unrelated — do not chase it
  here).
- The public API (`FBXLoader` export shape) changed such that
  `FBXLoaderPatched.d.ts` no longer matches — report before editing the stub.

## Maintenance notes

- Every future `three` bump now fails `check:vendored-three` until the fork is
  re-vendored — that's the intended forcing function. Document the re-vendor
  steps (this plan) in the script's failure message or a comment.
- Reviewer: confirm the file is upstream-0.180 + exactly two patches, not a
  reformatted or partially-merged blend; the diff vs
  `node_modules/three/examples/jsm/loaders/FBXLoader.js` should be small and
  entirely explained by the two documented patches plus the header.
- Deferred: actually upgrading `three` past 0.180 is a separate migration
  (blast radius includes `@types/three`, `@pixiv/three-vrm` peer range, and all
  loaders) — not in scope here.
