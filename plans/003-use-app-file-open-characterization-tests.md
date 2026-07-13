# Plan 003: Characterization tests for useAppFileOpen (the file-open critical path)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96a931e..HEAD -- src/app/useAppFileOpen.ts src/app/__tests__/`
> If `useAppFileOpen.ts` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (test-only; no production code changes)
- **Depends on**: none — but MUST land before plan 004, which modifies this hook
- **Category**: tests
- **Planned at**: commit `96a931e`, 2026-07-13

## Why this matters

`src/app/useAppFileOpen.ts` (~419 lines) is the single hook that wires every
way a file enters the app: the open dialog, Tauri drag-and-drop events,
startup/open-with arguments, directory-sibling navigation, and loader-pack
file requests. It is the literal reason the product exists — and it has zero
tests, despite six refactor commits landing on it. Plan 004 is about to modify
it again (adding a stale-request guard). This plan characterizes current
behavior first so plan 004 (and every future refactor) has a regression net.

## Current state

- `src/app/useAppFileOpen.ts` — the hook under test. Key structure:
  - `performSelectFilePath(path, reason)` (lines 162-191): sets loading
    feedback on the viewer store, then
    `await Promise.all([resolveSelectedFile(path), listSupportedSiblings(path)])`,
    then `setCurrentFile(resolvedFile)`, `setPackFileRequest(null)`,
    `setDirectoryListing(listing)`, `prefetchAdjacent(...)`,
    `recordLoadTiming(startedAt, reason)`.

    ```ts
    // useAppFileOpen.ts:162-183 (excerpt)
    const performSelectFilePath = useCallback(
      async (path: string, reason: OpenReason = "open") => {
        const startedAt = performance.now();
        setOpenError(null);
        useViewerStore.getState().updateViewerFeedback({
          mode: "loading",
          message: `Resolving ${path}`,
          ...
        });
        const [resolvedFile, listing] = await Promise.all([
          resolveSelectedFile(path),
          listSupportedSiblings(path),
        ]);
        setCurrentFile(resolvedFile);
        setPackFileRequest(null);
        setDirectoryListing(listing);
        prefetchAdjacent(listing.files, listing.currentIndex);
        recordLoadTiming(startedAt, reason);
      }, [...]);
    ```

  - `selectExternalFilePathFromEffect` (lines 193-204): dedupes repeated
    external opens of the same path within 2000ms via
    `recentExternalOpenRef`, then calls `performSelectFilePath(path, "startup")`.
  - Read the rest of the file before writing tests: it also handles the Tauri
    file-drop listener, the startup-file fetch, the open dialog, and error
    handling around them (look for `setOpenError` call sites — error paths are
    part of the characterization).

- Dependencies to mock (check the import block at the top of
  `useAppFileOpen.ts` for exact names): `../lib/files` (e.g.
  `resolveSelectedFile`, `listSupportedSiblings`, `openFileDialog`,
  `getStartupFile` — use the actual exported names), Tauri event APIs
  (`@tauri-apps/api/...` — whatever the file imports for drag-drop/window),
  `../viewer/prefetchCache` (or wherever `prefetchAdjacent` comes from — check
  the import).
- Stores are real zustand stores — do NOT mock them; set and read state via
  `useViewerStore.setState/getState` like the exemplar test does.
- **Exemplar test to model after**: `src/app/__tests__/useAppCommands.test.tsx`
  — shows the house style: `vi.mock` for Tauri modules at top,
  `renderHook` from `@testing-library/react`, `act()` wrappers,
  `beforeEach` with `vi.clearAllMocks()` + `useViewerStore.setState(...)`,
  `afterEach(cleanup)`.
- Vitest runs with jsdom (see `vitest.config.ts`); test files live in
  `src/app/__tests__/*.test.tsx`.

## Commands you will need

| Purpose             | Command                                                    | Expected on success |
| ------------------- | ---------------------------------------------------------- | ------------------- |
| Run just this test  | `npx vitest run src/app/__tests__/useAppFileOpen.test.tsx` | all pass            |
| Typecheck           | `npm run typecheck:ts`                                     | exit 0              |
| Lint                | `npm run lint`                                             | exit 0              |
| Full frontend suite | `npm run test`                                             | all pass            |

## Scope

**In scope**:

- `src/app/__tests__/useAppFileOpen.test.tsx` (create)

**Out of scope** (do NOT touch):

- `src/app/useAppFileOpen.ts` itself — this plan is characterization ONLY. If
  a test reveals a bug, write the test asserting **current** behavior with a
  `// BUG:` comment and report it; do not fix. (Known bug, deliberately left
  in: no stale-request guard — plan 004 fixes it and will update the test.)
- Any store or lib file.

## Git workflow

- Alpha mode: commit directly to `develop`; do NOT push. One commit, e.g.
  `Add useAppFileOpen characterization tests`.

## Steps

### Step 1: Read the hook and inventory its inputs/outputs

Read `src/app/useAppFileOpen.ts` fully. List (in a scratch note, not the repo):
its props/arguments, every `lib/files` function it calls, every store setter
it calls, every Tauri event it subscribes to, and its return value. Confirm
the mock list in "Current state" matches reality.

**Verify**: no command — proceed when the import block and the hook signature
are fully accounted for in your mock plan.

### Step 2: Scaffold the test file with mocks

Create `src/app/__tests__/useAppFileOpen.test.tsx` modeled on
`useAppCommands.test.tsx`. Mock `../lib/files` functions with `vi.fn()`
returning configurable promises. For Tauri event subscriptions, capture the
registered handler so tests can invoke it manually (mock `listen` to store the
callback and return an unlisten fn).

**Verify**: `npx vitest run src/app/__tests__/useAppFileOpen.test.tsx` → the
file runs (even with 1 trivial test) with no module-resolution errors.

### Step 3: Characterize the core flows

Write tests covering, at minimum:

1. **Successful open**: calling the hook's select/open function with a path
   resolves file + siblings and sets `currentFile`, `directoryListing`, clears
   `openError`, and sets loading feedback on the viewer store first
   (assert `updateViewerFeedback` effect via store state: mode "loading").
2. **Resolve failure**: `resolveSelectedFile` rejects → `openError` is set
   (assert the exact current message-shaping behavior), `currentFile`
   unchanged.
3. **External-open dedupe**: the same external path twice within 2s triggers
   only one `resolveSelectedFile` call; a different path is not deduped.
4. **Startup file**: whatever the hook does on mount when a startup file
   exists (mock it) — assert it selects that file with reason "startup".
5. **Drag-and-drop**: invoke the captured Tauri event handler with a payload
   shaped like the real event (copy the shape from the hook's handler code)
   → file gets selected.
6. **Overlapping requests (documents the known bug)**: fire select(A), then
   select(B) before A resolves; resolve B first, then A. Assert
   `currentFile` ends as **A** (the stale one) with a comment:
   `// BUG (plan 004 fixes this): last-resolved wins, not last-requested.`
   Use `vi.useFakeTimers()`-free promise control: keep `resolve` callbacks
   from the mocks and settle them manually in order.

**Verify**: `npx vitest run src/app/__tests__/useAppFileOpen.test.tsx` → ≥6
tests pass.

### Step 4: Full-suite and lint gates

**Verify**: `npm run test` → all pass; `npm run typecheck:ts` → exit 0;
`npm run lint` → exit 0.

## Test plan

This plan IS the test plan (Steps 2–3). Pattern:
`src/app/__tests__/useAppCommands.test.tsx`.

## Done criteria

- [ ] `src/app/__tests__/useAppFileOpen.test.tsx` exists with ≥6 passing tests
- [ ] Test 6 documents the stale-request behavior with a `BUG` comment referencing plan 004
- [ ] `npm run test`, `npm run typecheck:ts`, `npm run lint` all exit 0
- [ ] `git status` shows only the new test file
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `useAppFileOpen.ts` has structurally changed vs the excerpts (e.g. the
  stale-request guard already exists — then test 6 should assert the FIXED
  behavior instead; confirm with the operator/plans/README whether plan 004
  already ran).
- The hook cannot be rendered in isolation because it requires providers or
  Tauri globals that can't be mocked at module level — report what it needs
  rather than restructuring production code.
- Mocking `lib/files` pulls in a transitive Tauri import that crashes jsdom —
  check how `src/lib/__tests__/files.test.ts` mocks `invoke` and reuse that
  approach; if still stuck after one attempt, STOP.

## Maintenance notes

- Plan 004 will change test 6's expected outcome from "stale A wins" to
  "B wins"; that flip is the proof the fix works.
- When the error-experience work (B3/B7 in ROADMAP) reshapes `openError`
  handling, tests 2's message assertions will need updating — assert on
  presence + key content, not exact full strings, to keep that cheap.
