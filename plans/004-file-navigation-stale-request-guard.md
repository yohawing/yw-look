# Plan 004: Drop stale file-open results so rapid navigation never displays the wrong file

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96a931e..HEAD -- src/app/useAppFileOpen.ts src/hooks/useKeyboardShortcuts.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003-use-app-file-open-characterization-tests.md (its test 6 documents the bug this plan fixes)
- **Category**: bug
- **Planned at**: commit `96a931e`, 2026-07-13

## Why this matters

`performSelectFilePath` in `src/app/useAppFileOpen.ts` awaits
`resolveSelectedFile` + `listSupportedSiblings` and then unconditionally
commits the result to the stores. There is no generation counter or abort
check, and its callers fire on every ArrowLeft/ArrowRight keydown
(`src/hooks/useKeyboardShortcuts.ts:46-62`) and on sidebar file clicks. If an
older, slower request (large file, network drive) resolves after a newer one,
the app silently reverts to showing the stale file — viewport, sidebar, and
title all wrong, with no error. For an inspection tool whose core promise is
"確認の速さ / 問題の発見しやすさ" (CONCEPT.md), showing the wrong asset without
any signal is a first-class defect. The codebase already has the right idiom
for this (`isSessionStale` guards in `src/hooks/usePayloadSession.ts`); this
plan applies the same idea here.

## Current state

- `src/app/useAppFileOpen.ts:162-191` — the unguarded commit:

  ```ts
  const performSelectFilePath = useCallback(
    async (path: string, reason: OpenReason = "open") => {
      const startedAt = performance.now();
      setOpenError(null);
      useViewerStore.getState().updateViewerFeedback({
        mode: "loading",
        message: `Resolving ${path}`,
        warning: null,
        canResetCamera: false,
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
    },
    [
      recordLoadTiming,
      setCurrentFile,
      setDirectoryListing,
      setPackFileRequest,
      setOpenError,
    ],
  );
  ```

- Rapid-fire callers (no changes needed there; listed as evidence):
  - `src/hooks/useKeyboardShortcuts.ts:46-62` — ArrowLeft/ArrowRight keydown
    → `navigateFromEffect(nextFile.path, "navigation")` with no debounce.
  - `src/app/useSidebarModel.tsx:271-286` — sibling/recent-file clicks.
- The hook already uses refs (e.g. `recentExternalOpenRef` at ~line 196), so
  adding one more ref follows existing style.
- Error handling: callers `.catch` rejections (e.g.
  `useKeyboardShortcuts.ts:50` `.catch(onNavigateError)`) — the guard must not
  swallow rejections; only successful-but-stale results are dropped.
- Characterization tests from plan 003:
  `src/app/__tests__/useAppFileOpen.test.tsx`, whose test 6 asserts the buggy
  behavior (`currentFile` ends as the stale file) with a `// BUG` comment.

## Commands you will need

| Purpose           | Command                                                    | Expected on success |
| ----------------- | ---------------------------------------------------------- | ------------------- |
| This hook's tests | `npx vitest run src/app/__tests__/useAppFileOpen.test.tsx` | all pass            |
| Typecheck         | `npm run typecheck:ts`                                     | exit 0              |
| Full check        | `npm run check`                                            | exit 0              |

## Scope

**In scope**:

- `src/app/useAppFileOpen.ts`
- `src/app/__tests__/useAppFileOpen.test.tsx` (update test 6)

**Out of scope** (do NOT touch):

- `src/hooks/useKeyboardShortcuts.ts`, `src/app/useSidebarModel.tsx` — no
  debouncing at call sites; the guard belongs in one place.
- `src/hooks/usePayloadSession.ts` — referenced as the idiom exemplar only.
- Loader-level cancellation (AbortController through to loaders) — bigger
  change, explicitly deferred; this plan only prevents stale store commits.

## Git workflow

- Alpha mode: commit directly to `develop`; do NOT push. One commit, e.g.
  `Ignore stale file-open results during rapid navigation`.

## Steps

### Step 1: Add a request-generation guard

In `useAppFileOpen.ts`, add a ref near the other refs:

```ts
const selectRequestIdRef = useRef(0);
```

In `performSelectFilePath`, capture and check it:

```ts
const requestId = ++selectRequestIdRef.current;
// ... existing feedback + Promise.all ...
if (requestId !== selectRequestIdRef.current) {
  return; // a newer selection superseded this one; drop the stale result
}
setCurrentFile(resolvedFile);
setPackFileRequest(null);
setDirectoryListing(listing);
prefetchAdjacent(listing.files, listing.currentIndex);
recordLoadTiming(startedAt, reason);
```

Rules:

- Increment BEFORE the awaits, check AFTER them, before any store writes.
- Do not wrap in try/catch — rejections must still propagate to callers.
- Keep `setOpenError(null)` and the loading feedback before the awaits
  (unchanged): the newest request owns the loading state.
- If the file contains other functions that commit `setCurrentFile` from an
  awaited path (read the whole hook — e.g. dialog-open or startup flows that
  do NOT go through `performSelectFilePath`), route them through
  `performSelectFilePath` if trivially possible; otherwise leave them and note
  it in the completion report. Only `performSelectFilePath` is required here.

**Verify**: `npm run typecheck:ts` → exit 0

### Step 2: Flip characterization test 6 to assert the fix

In `src/app/__tests__/useAppFileOpen.test.tsx`, update the overlapping-request
test: fire select(A), then select(B); resolve B first, then A. Assert
`currentFile` is **B** and that A's late resolution did not overwrite the
directory listing either. Remove the `// BUG` comment; rename the test to
state the guarantee (e.g. "drops results of superseded selections"). Add one
more case: select(A) then select(B), resolve in order A→B — final state is B
(the guard doesn't break the ordinary sequential case).

**Verify**: `npx vitest run src/app/__tests__/useAppFileOpen.test.tsx` → all
pass, including the two ordering cases.

### Step 3: Full gates

**Verify**: `npm run check` → exit 0.

## Test plan

Step 2. Pattern: the existing tests in the same file (from plan 003). The
ordering tests control promise settlement manually via captured resolvers.

## Done criteria

- [ ] Out-of-order resolution test asserts the newest request wins (test exists and passes)
- [ ] In-order resolution still ends on the last request (test exists and passes)
- [ ] No try/catch added around the awaits (rejections still reach callers — verify by reading the diff)
- [ ] `npm run check` exits 0
- [ ] Only the two in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 003's test file does not exist (execute plan 003 first).
- The excerpt no longer matches — in particular if a guard/AbortController
  already appeared in `performSelectFilePath`.
- Fixing test 6 reveals the guard breaks the external-open dedupe flow
  (`selectExternalFilePathFromEffect`) — report the interaction instead of
  restructuring the dedupe.

## Maintenance notes

- This guard drops stale _store commits_; the stale request's loader work
  (resolve + sibling listing) still runs to completion. If profiling later
  shows wasted backend work during fast browsing, the follow-up is an
  AbortController threaded into `resolveSelectedFile` — a separate plan.
- Reviewer: check the guard sits after BOTH awaited calls and before ALL five
  commit statements; a partial commit (file set, listing stale) would be worse
  than the current bug.
- The viewer feedback ("Resolving …") of a superseded request is intentionally
  left to be overwritten by the newer request's feedback — the newest request
  sets it last. No flicker handling needed.
