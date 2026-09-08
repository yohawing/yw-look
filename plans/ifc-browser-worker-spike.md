# IFC Phase 0B browser/local-worker seam probe

実施日: 2026-08-06（Windows、Node `v22.14.0`、npm `11.13.0`）
対象: Matrix B（`three@0.182.0`、`@types/three@0.182.0`、`@thatopen/fragments@3.4.7`、`web-ifc@0.0.77`）
probe root: `C:\Users\yohaw\AppData\Local\Temp\yw-look-ifc-compat-20260806-3ffaa4f23d89431186110ba7369f9383`

## RESULT

判定は **CONDITIONAL-GO**。Phase 0C の shared seam spike へ進む browser 側の根拠は得られた。
明示した localhost worker/WASM だけで IFC bytes → Fragments bytes → `FragmentsModels.load` →
`THREE.Object3D` mount、spatial/local-id/geometry query、3 回の dispose lifecycle、abort を再現できた。

ただし、Fragments の documented `Item.getCategory()` は browser worker で
`TypeError: model[input.function] is not a function`（worker に `getItemCategory` がない）となったため、
成功した seam は `getLocalId` / `getGuid` / `getGeometry` / model-level geometry query を使っている。
Tauri custom protocol、WebGL visual correctness、memory release、repo の Three upgrade はこの probe では証明しない。

## CHANGES

- 許可された新規ファイル [plans/ifc-browser-worker-spike.md](F:/Develop/yw-look-ifc-loader/plans/ifc-browser-worker-spike.md) のみを追加した。
- repo の package/source、既存の `plans/ifc-compatibility-spike.md` と `plans/ifc-loader-pack.md` は変更していない。
- probe の Vite page、runner、assets、logs はすべて上記 TEMP root 配下に置いた。

## VERIFICATION

### 1. TEMP probe setup

既存 Matrix B の clean TEMP project に browser-only probe tools を追加した。

```powershell
npm install --save-dev --ignore-scripts --no-audit --no-fund vite@8.2.0 playwright@1.62.1
node run-browser-probe.mjs
```

`npm ls` の relevant versions:

```text
@thatopen/fragments@3.4.7
@types/three@0.182.0
playwright@1.62.1
three@0.182.0
vite@8.2.0
web-ifc@0.0.77
```

生成した probe files:

- `browser-probe/index.html`
- `browser-probe/main.js`
- `run-browser-probe.mjs`
- `browser-probe-run.log`

localhost に同梱した payload:

| asset                                              |     bytes | SHA-256                                                            |
| -------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `browser-probe/public/assets/example.ifc`          |   413,681 | `DB372F3F57796E2F572958C1C144BF3D8BE7912493738636A2152CF18F08A14D` |
| `browser-probe/public/assets/web-ifc.wasm`         | 1,303,940 | `392B547232AA63DF84961D9D3D6E2A7A259CD832B888830CAB2EE30778BF28A0` |
| `browser-probe/public/assets/fragments-worker.mjs` | 3,267,026 | `B943C3BFD31793B9FDAC0A2ECA94176447D44624173B51C60BCB45834E62050B` |

### 2. Browser sequence and local URL policy

Page は次の URL を明示した。

```text
IFC:    http://127.0.0.1:5174/assets/example.ifc
WASM:   http://127.0.0.1:5174/assets/
Worker: http://127.0.0.1:5174/assets/fragments-worker.mjs
```

`getWorker()` は呼び出していない。`IfcImporter.wasm.path` は上記 WASM directory、`absolute=true`。
`FragmentsModels` は explicit worker URL、`maxWorkers: 2` で構築した。Playwright context route は
localhost (`127.0.0.1` / `localhost`) と `data:` / `blob:` 以外を abort し、全 request URL を記録した。

観測 request list（blocked non-local request: **0**）:

```text
http://127.0.0.1:5174/
http://127.0.0.1:5174/@vite/client
http://127.0.0.1:5174/main.js
http://127.0.0.1:5174/@fs/C:/Users/yohaw/AppData/Local/Temp/yw-look-ifc-compat-20260806-3ffaa4f23d89431186110ba7369f9383/matrix-b-three-0.182/node_modules/vite/dist/client/env.mjs
http://127.0.0.1:5174/@fs/C:/Users/yohaw/AppData/Local/Temp/yw-look-ifc-compat-20260806-3ffaa4f23d89431186110ba7369f9383/matrix-b-three-0.182/node_modules/.vite/deps/three.js?v=6802f102
http://127.0.0.1:5174/@fs/C:/Users/yohaw/AppData/Local/Temp/yw-look-ifc-compat-20260806-3ffaa4f23d89431186110ba7369f9383/matrix-b-three-0.182/node_modules/.vite/deps/@thatopen_fragments.js?v=6802f102
http://127.0.0.1:5174/@fs/C:/Users/yohaw/AppData/Local/Temp/yw-look-ifc-compat-20260806-3ffaa4f23d89431186110ba7369f9383/matrix-b-three-0.182/node_modules/.vite/deps/three.module-BQ0TNVQb.js?v=6802f102
http://127.0.0.1:5174/assets/example.ifc
http://127.0.0.1:5174/assets/web-ifc.wasm
http://127.0.0.1:5174/assets/web-ifc.wasm
http://127.0.0.1:5174/assets/web-ifc.wasm
http://127.0.0.1:5174/assets/fragments-worker.mjs
http://127.0.0.1:5174/assets/fragments-worker.mjs
http://127.0.0.1:5174/assets/fragments-worker.mjs
http://127.0.0.1:5174/assets/fragments-worker.mjs
```

全体 probe は `857.0 ms`、IFC→Fragments conversion は `188.5 ms` だった（単一 run の timing）。
Three revision は `182`、IFC bytes は `413,681`、Fragments bytes は `87,604`。

### 3. Three / Fragments load-query-dispose cycles

各 cycle は独立した `FragmentsModels`（`maxWorkers=2`）を作り、次を実行した。

1. fragment buffer の独立 copy を `load`（worker transfer で元 buffer が detach されるため）。
2. `model.object` を `THREE.Scene` へ add、`PerspectiveCamera` を `useCamera`、`models.update(true)`。
3. `getSpatialStructure`、`getLocalIds`、`getItemsIdsWithGeometry`、`getItemsGeometry`、`getItem` の bounded query。
4. `THREE.Box3.setFromObject` で object bounds を取得。
5. `models.dispose()`、scene/worker state を確認。

| cycle | load ms | total ms | spatial nodes | local IDs | geometry IDs | Object3D children | bounds empty | scene children after dispose | active workers after dispose |
| ----: | ------: | -------: | ------------: | --------: | -----------: | ----------------: | ------------ | ---------------------------: | ---------------------------: |
|     1 |   154.6 |    195.3 |           134 |     1,319 |          116 |                 5 | false        |                            0 |                            0 |
|     2 |   155.4 |    194.2 |           134 |     1,319 |          116 |                 5 | false        |                            0 |                            0 |
|     3 |   152.3 |    190.7 |           134 |     1,319 |          116 |                 5 | false        |                            0 |                            0 |

selection/geometry evidence（全 cycle 同じ）:

- local-id sample: `[2863, 3014, 3182, 3296, 3732]`
- GUID sample: `2863 → 0VNYAWfXv8JvIRVfOzYH1j`、`3014 → 0VNYAWfXv8JvIRVfOzYH2H`、`3182 → 0VNYAWfXv8JvIRVfOzYG_K`
- geometry sample: `[2863, 3014, 3182]`
- first geometry payload: indices `Uint16Array(348)`、positions `Float32Array(540)`、normals `Int16Array(540)`
- mounted object: `Object3D`、visible `true`、children `5`
- bounds min `[-2.937549180908203, -4.05880100351572, -7.503112074508666]`、max
  `[22.363220302124024, 1.858199977016449, 2.2388288186645506]`

Worker tracker は cycle ごとに create/terminate を記録し、3 cycle 後は active `0`。probe 終了時も
scene children `0`、active workers `0` だった。これは observable worker/scene cleanup の証拠であり、memory release の証明ではない。

### 4. Abort probe

4 回目に `load` を開始して 1 ms 後に `models.abort("abort-cycle")` を呼び、次を観測した。

```text
elapsedMs: 81.2
outcome: LoadAbortedError: Fragments: Load of model "abort-cycle" was aborted.
activeWorkersAfterDispose: 0
```

したがってこの payload では abort/dispose seam も再現できた。

### 5. Errors and API compatibility observations

- 最終 run: `runnerError=null`、page errors `0`、request failures `0`、console error `0`、non-local request `0`。
  console は Vite の connecting/connected debug のみ。
- 初回実装で同一 transferred `fragmentBytes` を 2 cycle 目以降へ再利用すると、
  `DataCloneError: Failed to execute 'postMessage' on 'MessagePort': ArrayBuffer at index 0 is already detached.`
  となった。cycle ごとに `fragmentBytes.slice()` を渡すことで解消した。shared seam は buffer ownership を明示する必要がある。
- `Item.getCategory()` を bounded item query に追加した試行では、worker console に
  `TypeError: model[input.function] is not a function`（`dist/Worker/worker.mjs:82363`）が出て query が失敗した。
  `index.mjs` は `getItemCategory` を invoke するが、同梱 worker にその method symbol がないためと確認した。成功 run は
  `getLocalId`、`getGuid`、`getGeometry` と model-level geometry APIs を使用し、category は採用していない。

## RISKS

1. `Item.getCategory()` の package/worker API mismatch は 3.4.7 の browser selection seam で未解決。Phase 0C adapter はこの API を直接使わず、必要なら direct `web-ifc` category query または別 fallback を設計する。
2. この probe は localhost HTTP の browser context のみ。Tauri custom protocol、CSP、WebGL renderer parity、visual snapshot は未検証。
3. worker terminate と scene detach は観測したが、heap/native memory release や長時間 leak は証明していない。
4. 同じ fragment `ArrayBuffer` を複数 load へ渡すと detach するため、adapter は ownership/copy policy を明示する必要がある。
5. `getWorker()` の unpkg default は network/offline 契約に反する。Phase 0C でも explicit local worker URL と payload hash を使うこと。

## NEXT

1. Phase 0C shared-seam spike は **条件付きで着手可**。`LoadedPreview.createPackRuntime` に explicit local worker/WASM URL、scene mount、camera/update、local-id/geometry selection、dispose ownership を最小差分で接続する。
2. `Item.getCategory()` を使わない compatibility guard と fixture test を先に置き、必要な category/property 検索の fallback 境界を決める。
3. Phase 0C 後にのみ candidate Three `0.182.0` の repo gate（check、loader profiles、build、viewport snapshot、visual review）を別 slice として実行する。
4. Tauri/custom-protocol または category fallback が fail した場合は Fragments integration を広げず、同じ pack 境界で direct `web-ifc` Three adapter を比較する。

この report は browser/local-worker compatibility evidence であり、IFC loader 実装完了、Tauri compatibility、WebGL visual correctness、memory release、Three upgrade 承認を意味しない。
