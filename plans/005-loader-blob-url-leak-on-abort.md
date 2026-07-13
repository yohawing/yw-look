# Plan 005: Revoke blob object URLs when a loader aborts or refuses the worker fallback

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96a931e..HEAD -- src/viewer/gltf/loader.ts src/viewer/dae/loader.ts src/viewer/obj/loader.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (resource leak)
- **Planned at**: commit `96a931e`, 2026-07-13

## Why this matters

glTF and Collada loaders create `blob:` object URLs for buffers and image
references, collect them in a `cleanupUrls` array, and hand that array back to
the caller in the returned `LoadedPreview` so the dispose path can revoke them.
But on three error paths the function **throws before returning**, so the caller
never receives `cleanupUrls` and `URL.revokeObjectURL` is never called — the
Blob memory is pinned for the life of the webview. These paths are exactly the
common ones for this app: aborting a load by switching files fast, and glTF
files over the 50 MB worker-fallback limit. The product explicitly wants
thorough dispose on file switch (CONCEPT.md principle 1); this is a cumulative
leak across a browsing session. The adjacent glTF _missing-reference_ path
already does the revoke (`gltf/loader.ts:287-298`) — this plan brings the
abort/size-limit/decode paths up to the same standard.

## Current state

- `src/viewer/gltf/loader.ts:1002-1047` — after `materializeGltf` (which has
  already created blob URLs in `materialized.cleanupUrls`), the worker-parse
  `catch` re-throws on abort and on size-limit WITHOUT revoking:

  ```ts
  const materialized = await materializeGltf(file);
  throwIfAborted(context.signal);   // throws AbortError; cleanupUrls not revoked
  ...
  try {
    object = await parseModelInWorker(...);
    parsedInWorker = true;
  } catch (error) {
    if (isAbortOrTimeoutError(error)) {
      throw error;                  // cleanupUrls not revoked
    }
    if (materialized.rawText.length >= WORKER_FALLBACK_SIZE_LIMIT) {
      throw new Error(`Worker parsing failed for large file ...`, { cause: error }); // not revoked
    }
    console.warn("[gltf] worker parse failed, falling back to main thread:", error);
  }
  ```

  Contrast — the correct pattern already present a few hundred lines up:

  ```ts
  // gltf/loader.ts:287-298
  if (missingPaths.length > 0) {
    for (const url of cleanupUrls) {
      URL.revokeObjectURL(url);
    }
    const error = new Error(`Missing reference: ...`) as MissingReferenceError;
    ...
    throw error;
  }
  ```

- `src/viewer/dae/loader.ts:145-211` — same shape: `cleanupUrls` accumulates
  blob URLs for Collada image references (lines 158-171), then
  `parseModelInWorker` is called (line 193); the `catch` re-throws on
  `isAbortOrTimeoutError(error)` (lines 204-206) with no revocation. Also
  `throwIfAborted(context.signal)` at line 152 runs after `readTextFile` but
  before any URL creation, so that one is safe — the leak is the abort re-throw
  at 204-206 (URLs already created) and any throw after line 171.

- `src/viewer/obj/loader.ts:85-96` — `tryLoadTextureFromPath` creates an
  object URL then `TextureLoader().loadAsync(objectUrl)`; the `catch { return
null; }` swallows a decode failure without revoking `objectUrl`:

  ```ts
  async function tryLoadTextureFromPath(path: string) {
    try {
      const extension = path.split(".").pop()?.toLowerCase() ?? "bin";
      const objectUrl = await createBlobUrlFromPath(path, extension);
      const texture = await new TextureLoader().loadAsync(objectUrl);
      ...
      return { texture, objectUrl };
    } catch {
      return null;   // objectUrl leaked if loadAsync threw
    }
  }
  ```

- Existing tests: `src/viewer/*/__tests__/loader.test.ts`. There are FBX loader
  tests (`src/viewer/fbx/__tests__/loader.test.ts`) that mock loading; check
  for an existing gltf/dae/obj loader test to model after. In jsdom,
  `URL.createObjectURL`/`revokeObjectURL` may need stubbing — see how existing
  loader tests handle it (grep `revokeObjectURL` under `src/`).

- WIP note: `src/viewer/fbx/loader.ts` has an in-progress worker-offload change
  in the working tree. It has the same throw-then-return shape
  (`fbx/loader.ts:~1192`) but the frontend audit found no _live_ leak there yet
  (no texture loads before the throw). Do NOT modify fbx/loader.ts in this plan
  — it's moving under active work. It's listed in Maintenance notes to re-check
  once that lands.

## Commands you will need

| Purpose      | Command                     | Expected on success |
| ------------ | --------------------------- | ------------------- |
| Loader tests | `npx vitest run src/viewer` | all pass            |
| Typecheck    | `npm run typecheck:ts`      | exit 0              |
| Full check   | `npm run check`             | exit 0              |

## Scope

**In scope**:

- `src/viewer/gltf/loader.ts`
- `src/viewer/dae/loader.ts`
- `src/viewer/obj/loader.ts`
- Corresponding `__tests__` files for a new leak-regression test (create or
  extend whichever exists).

**Out of scope** (do NOT touch):

- `src/viewer/fbx/loader.ts` and its tests — active WIP (see note above).
- The dispose/mount path (`mountLoadedPreview`, `AssetViewport`) — the fix is
  in the loaders, which own the URLs until they successfully return them.
- `materializeGltf` internals — keep it returning `cleanupUrls`; only the
  throw sites downstream change.

## Git workflow

- Alpha mode: commit directly to `develop`; do NOT push. One commit, e.g.
  `Revoke loader blob URLs on abort and fallback refusal`.

## Steps

### Step 1: glTF — revoke on all throw-before-return paths

In `src/viewer/gltf/loader.ts`, in the `"gltf"` case, ensure
`materialized.cleanupUrls` is revoked before every throw that occurs after
`materializeGltf` succeeds and before the successful `return`. The cleanest
shape is a helper closure plus try/catch around the region:

```ts
const materialized = await materializeGltf(file);
const revokeMaterialized = () => {
  for (const url of materialized.cleanupUrls) URL.revokeObjectURL(url);
};
try {
  throwIfAborted(context.signal);
  await yieldToPaint();
  // ... worker parse try/catch ...
  // on the size-limit branch: throw as today
  // ... build and RETURN the LoadedPreview (success path unchanged) ...
} catch (error) {
  revokeMaterialized();
  throw error;
}
```

Important: only revoke on the throw path. On success the URLs must still be
handed back in the returned `LoadedPreview.cleanupUrls` (do NOT revoke then).
Ensure the existing missing-reference revoke (lines 287-298) is not
double-revoking — `revokeObjectURL` on an already-revoked URL is a harmless
no-op, but prefer to keep the two regions non-overlapping; the try/catch here
wraps only the post-`materializeGltf` region.

**Verify**: `npm run typecheck:ts` → exit 0

### Step 2: DAE — revoke on abort/error re-throw

In `src/viewer/dae/loader.ts`, wrap the region from after `cleanupUrls` starts
being populated through the parse in the same try/catch-revoke-rethrow shape,
or add `for (const url of cleanupUrls) URL.revokeObjectURL(url);` immediately
before the `throw error` at lines 204-206 and before any other throw after URL
creation. Success path still returns `cleanupUrls` to the caller unchanged.

**Verify**: `npm run typecheck:ts` → exit 0

### Step 3: OBJ — revoke on texture decode failure

In `tryLoadTextureFromPath`, revoke the created URL before returning null:

```ts
async function tryLoadTextureFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "bin";
  let objectUrl: string | null = null;
  try {
    objectUrl = await createBlobUrlFromPath(path, extension);
    const texture = await new TextureLoader().loadAsync(objectUrl);
    texture.colorSpace = SRGBColorSpace;
    texture.userData.textureSourceKind = "external";
    return { texture, objectUrl };
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return null;
  }
}
```

Only revoke on failure — on success `objectUrl` is returned and owned by the
caller.

**Verify**: `npm run typecheck:ts` → exit 0

### Step 4: Regression test

Add a test (model after the existing loader tests under `src/viewer/*/__tests__`):
stub `URL.createObjectURL` to return unique ids and spy on
`URL.revokeObjectURL`. For glTF: make `parseModelInWorker` reject with an
abort-like error on a small file and assert every created URL was revoked; for
OBJ: make `TextureLoader.loadAsync` reject and assert the URL was revoked and
the function returned null. Keep it minimal — one case per file is enough to
lock the behavior.

**Verify**: `npx vitest run src/viewer` → all pass, including the new cases.

## Test plan

Step 4. Structural pattern: existing `src/viewer/*/__tests__/loader.test.ts`.
Final gate: `npm run check`.

## Done criteria

- [ ] glTF abort and size-limit throw paths revoke `materialized.cleanupUrls` (test asserts it)
- [ ] DAE abort re-throw revokes `cleanupUrls`
- [ ] OBJ `tryLoadTextureFromPath` revokes `objectUrl` on decode failure (test asserts it)
- [ ] Success paths still return `cleanupUrls`/`objectUrl` to the caller (unchanged; no revoke on success)
- [ ] `npm run check` exits 0
- [ ] `src/viewer/fbx/loader.ts` NOT modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The excerpts don't match (someone already added revoke-on-abort here).
- You discover the success path also relies on NOT revoking but the return
  shape has changed such that ownership is ambiguous — report the ownership
  question rather than guessing.
- jsdom lacks `URL.revokeObjectURL` and no existing test stubs it — check for
  a shared test setup (`vitest.config.ts` `setupFiles`) and add the stub there
  only if that's the established pattern; otherwise stub locally.

## Maintenance notes

- Once the FBX worker-offload WIP (`src/viewer/fbx/loader.ts`,
  `src/workers/staticScene.ts`) lands, re-check its throw-before-return shape
  around `createFbxLoadingManager` — if it starts loading textures before the
  post-materialize `throwIfAborted`, it needs the same revoke-on-throw guard.
- Reviewer: verify no revoke happens on the success path in any of the three
  files (that would blank out textures) — the revoke must be reachable ONLY
  via a throw/return-null branch.
