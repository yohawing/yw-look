# Plan 006: Retry (or surface) USD inspector RPCs on "busy" instead of silently giving up

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96a931e..HEAD -- src/hooks/useUsdInspector.ts src/hooks/usePayloadSession.ts src/lib/usd.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S/M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `96a931e`, 2026-07-13

## Why this matters

`useUsdInspector` fires four USD backend RPCs (`summarizeStage`,
`inspectStage`, `collectAssetIssues`, `inspectUsdLights`). Each `.catch`
does `if (isUsdTaskBusyError(error)) return;` — on a "busy" error it neither
retries nor sets an error, and `Promise.allSettled(...).then(() =>
setUsdInspectorLoading(false))` marks the load done regardless. Because the app
runs several USD RPCs concurrently against a single stage (session open,
geometry extraction, payload load), "busy" is a realistic transient condition —
and when it happens the USD summary / composition / lights panels end up
permanently empty while the UI reports success. That silent empty state
directly violates CONCEPT.md principle 4 ("no silent failures") on a path
central to the app's USD value proposition. The codebase already has the
correct retry idiom (`retryWhileBusy` in `usePayloadSession.ts`); this plan
reuses it.

## Current state

- `src/hooks/useUsdInspector.ts:68-149` — the four RPCs, each swallowing busy:

  ```ts
  // useUsdInspector.ts:69-82 (summarize; the other three follow the same shape)
  const summarizePromise = summarizeStage(path, usdLoadPolicy, { background: true })
    .then((summary) => { if (cancelled) return; setUsdSummary(summary); })
    .catch((error: unknown) => {
      if (cancelled) return;
      if (isUsdTaskBusyError(error)) return;   // <-- silent give-up on busy
      setUsdInspectorError(errorMessage(error, "Failed to summarize USD stage."));
    });
  // inspectStage:  useUsdInspector.ts:84-98   (same pattern)
  // collectAssetIssues (loadAll only): 100-116
  // inspectUsdLights   (loadAll only): 118-134
  void Promise.allSettled([...]).then(() => {
    if (cancelled) return;
    setUsdInspectorLoading(false);   // marks done even if all four were busy
    ...
  });
  ```

  The effect's `cancelled` flag is set true in cleanup when `currentFile`
  changes (standard pattern; read lines 37-62 for the setup and the
  `USD_INSPECTOR_DEFER_MS`/`setTimeout` wrapper).

- `src/hooks/usePayloadSession.ts:122-150` — the existing retry helper (NOT
  currently exported):

  ```ts
  async function retryWhileBusy<T>(
    task: () => Promise<T>,
    options: { shouldAbort?: () => boolean; onBusyRetry?: () => void } = {},
  ): Promise<T | undefined> {
    for (
      let attempt = 0;
      attempt <= DEFERRED_PAYLOAD_PREVIEW_LIMITS.maxBusyRetries;
      attempt += 1
    ) {
      try {
        return await task();
      } catch (error) {
        if (!isUsdTaskBusyError(error)) throw error;
        if (options.shouldAbort?.()) return undefined;
        options.onBusyRetry?.();
        await yieldDeferredPreviewFrame(
          DEFERRED_PAYLOAD_PREVIEW_LIMITS.busyRetryMs,
        );
      }
    }
    return undefined; // exhausted retries
  }
  ```

  `DEFERRED_PAYLOAD_PREVIEW_LIMITS` and `yieldDeferredPreviewFrame` are defined
  in usePayloadSession's module scope / imports — check exact locations before
  moving the helper.

- `src/lib/usd.ts:123` — `isUsdTaskBusyError` (already shared).
- Tests: `src/hooks/__tests__/usePayloadSession.test.tsx` mocks
  `isUsdTaskBusyError`; there is no `useUsdInspector` test today (confirm with
  `ls src/hooks/__tests__`).

## Commands you will need

| Purpose    | Command                    | Expected on success |
| ---------- | -------------------------- | ------------------- |
| Hook tests | `npx vitest run src/hooks` | all pass            |
| Typecheck  | `npm run typecheck:ts`     | exit 0              |
| Full check | `npm run check`            | exit 0              |

## Scope

**In scope**:

- `src/hooks/useUsdInspector.ts`
- A new shared module for `retryWhileBusy`, e.g.
  `src/lib/usdBusyRetry.ts` (create) — OR export it from `src/lib/usd.ts`.
  Pick whichever keeps imports acyclic (see Step 1).
- `src/hooks/usePayloadSession.ts` — ONLY to import the helper from its new
  home instead of defining it locally (keep behavior identical).
- `src/hooks/__tests__/useUsdInspector.test.tsx` (create).

**Out of scope**:

- `DEFERRED_PAYLOAD_PREVIEW_LIMITS` values / retry timing — reuse as-is.
- The Rust backend "busy" semantics — unchanged.
- `usePayloadSession`'s own logic beyond the import swap.

## Git workflow

- Alpha mode: commit directly to `develop`; do NOT push. One commit, e.g.
  `Retry USD inspector RPCs on busy instead of silent empty`.

## Steps

### Step 1: Extract `retryWhileBusy` to a shared module

Move `retryWhileBusy` (and only what it needs:
`DEFERRED_PAYLOAD_PREVIEW_LIMITS`, `yieldDeferredPreviewFrame`,
`isUsdTaskBusyError`) into a location importable by both hooks without a
cycle. Preferred: a new `src/lib/usdBusyRetry.ts` that imports the limits/yield
helpers from their current module and `isUsdTaskBusyError` from `src/lib/usd.ts`.
Update `usePayloadSession.ts` to import it instead of its local copy; delete
the local definition. Behavior must be byte-for-byte identical.

**Verify**: `npx vitest run src/hooks/__tests__/usePayloadSession.test.tsx`
→ still all pass (no behavior change); `npm run typecheck:ts` → exit 0.

### Step 2: Route the four inspector RPCs through `retryWhileBusy`

In `useUsdInspector.ts`, wrap each RPC so a busy error retries and, when
retries are exhausted (helper returns `undefined`), an error is surfaced
instead of silently resolving. Shape per RPC (summarize shown):

```ts
const summarizePromise = retryWhileBusy(
  () => summarizeStage(path, usdLoadPolicy, { background: true }),
  { shouldAbort: () => cancelled },
)
  .then((summary) => {
    if (cancelled || summary === undefined) return; // undefined = aborted (cancelled)
    setUsdSummary(summary);
  })
  .catch((error: unknown) => {
    if (cancelled) return;
    setUsdInspectorError(errorMessage(error, "Failed to summarize USD stage."));
  });
```

Decision to make explicit: `retryWhileBusy` returns `undefined` BOTH when
aborted (cancelled) AND when retries are exhausted while still busy. For the
inspector we want: cancelled → stay silent; exhausted-busy → surface an error.
To distinguish, pass an `onExhausted`-style flag: set a local
`let stillBusy = false;` and use `onBusyRetry`? No — simpler: after the helper
resolves to `undefined` and `!cancelled`, treat it as a busy-exhaustion error
and set `usdInspectorError` (e.g. "USD backend stayed busy; inspection
incomplete — reopen the file to retry"). Apply the same pattern to all four
RPCs, matching each one's existing error message and its
`setUsdInspectorError((previous) => previous ?? ...)` vs direct-set style
(inspect/issues use the `previous ??` form; summarize/lights set directly —
preserve that).

Keep the `Promise.allSettled(...).then(() => setUsdInspectorLoading(false))`
as-is; loading still ends after all four settle, but now the panels are either
populated or an error is shown.

**Verify**: `npm run typecheck:ts` → exit 0

### Step 3: Test the busy behavior

Create `src/hooks/__tests__/useUsdInspector.test.tsx` (model mocking style
after `usePayloadSession.test.tsx`). Mock `../lib/usd` RPCs and
`isUsdTaskBusyError`. Cases:

1. RPC that rejects busy once then succeeds → panel state gets set; no error.
2. RPC that rejects busy every time (exhausts retries) → `usdInspectorError`
   is set (NOT silently empty).
3. Cancellation (file changes / unmount) during busy → no error set, no state
   set after cancel.
4. Non-busy rejection → error set immediately (unchanged behavior).

Keep retry timing fast in tests (the helper awaits `yieldDeferredPreviewFrame`
with `busyRetryMs`; use fake timers or a mocked yield so the test doesn't wait
real milliseconds — check how usePayloadSession.test handles this).

**Verify**: `npx vitest run src/hooks` → all pass including the 4 new cases.

### Step 4: Full gate

**Verify**: `npm run check` → exit 0.

## Test plan

Step 3. Pattern: `src/hooks/__tests__/usePayloadSession.test.tsx`. Final gate:
`npm run check`.

## Done criteria

- [ ] `retryWhileBusy` lives in one shared module; both hooks import it; no duplicate definition (`grep -rn "function retryWhileBusy" src/` → exactly 1)
- [ ] All four inspector RPCs retry on busy and surface an error on exhaustion
- [ ] Cancellation during busy sets no error (test asserts)
- [ ] `usePayloadSession` tests still pass unchanged
- [ ] `npm run check` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Extracting `retryWhileBusy` creates an import cycle you can't resolve in one
  move — report the dependency shape.
- The excerpts don't match (someone already added retry here).
- `DEFERRED_PAYLOAD_PREVIEW_LIMITS.maxBusyRetries` is 0 or the retry would add
  noticeable latency to the normal (non-busy) path — it should not, since the
  happy path returns on the first `await task()`; if you find the helper adds a
  delay even without a busy error, STOP and report.

## Maintenance notes

- If the USD backend later exposes a proper queue (so "busy" can't happen),
  this retry becomes dead weight — revisit then.
- Reviewer: confirm the non-busy happy path is unchanged (first-attempt
  success, no added await) and that cancelled vs exhausted-busy are
  distinguished (cancelled must stay silent — surfacing an error on every fast
  file-switch would be its own silent-failure-inverse annoyance).
- The error copy for busy-exhaustion is a placeholder; the error-experience
  work (B7) may restyle it.
