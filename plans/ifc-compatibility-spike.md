# IFC Phase 0A 依存・API 互換性 probe evidence

実施日: 2026-08-06（`npm 11.13.0`、`node v22.14.0`、Windows）
対象: `@thatopen/fragments` / `web-ifc` と Three.js の依存・Node API・worker/WASM payload
一時 probe root: `C:\Users\yohaw\AppData\Local\Temp\yw-look-ifc-compat-20260806-3ffaa4f23d89431186110ba7369f9383`

## RESULT

判定は **CONDITIONAL-GO**。Phase 0B の seam spike（まだ loader 実装や依存変更をしない）へ進める根拠は得られたが、
Fragments の browser worker、offline local URL、Three `0.182` を入れた実アプリの既存 gate は未証明である。これは IFC 完全実装の
GO、Three upgrade の承認、Tauri renderer parity の証明ではない。

- Matrix A（Three `0.180.0`）は通常の npm peer resolution で **失敗**した。`@thatopen/fragments@3.4.7` が
  `three >=0.182.0` を要求するためで、force/legacy peer で無理に通していない。
- Matrix B（Three `0.182.0`、`@types/three@0.182.0`）は install、`npm ls` の単一 Three、ESM import が **成功**した。
- `web-ifc@0.0.77` の Node `IfcAPI` は公式 IFC を Init → OpenModel → schema/line/geometry query → CloseModel まで **成功**した。
- `@thatopen/fragments@3.4.7` の `IfcImporter.process` は Node で IFC bytes を fragments bytes へ変換できた。
  ただし `FragmentsModels.load` は Node に Web Worker global がないため **未証明/ブロック**した。
- Fragments の `getWorker()` 実装は `https://unpkg.com/.../worker.mjs` を生成する。offline 配布では使わず、同梱 worker の明示 URLを
  `FragmentsModels(workerURL, ...)` へ渡す必要がある。これは Vite/browser probe で実証すべき条件である。

## CHANGES

- 許可された新規ファイル [plans/ifc-compatibility-spike.md](F:\Develop\yw-look-ifc-loader\plans\ifc-compatibility-spike.md) のみを追加した。
- repo の `package*.json`、`src/**`、`src-tauri/**`、`scripts/**`、既存の `plans/ifc-loader-pack.md` は変更していない。
- npm install、生成 script、probe code、IFC samples はすべて上記 TEMP root 配下に置いた。repo へ依存をインストールしていない。

## VERIFICATION

### 1. npm metadata（2026-08-06）

実行コマンド:

```powershell
npm view @thatopen/fragments version license peerDependencies dependencies dist.unpackedSize main module browser exports --json
npm view web-ifc version license peerDependencies dependencies dist.unpackedSize main module browser exports --json
npm view three@0.180.0 version license dist.unpackedSize --json
npm view three@0.182.0 version license dist.unpackedSize --json
npm view @types/three@0.180.0 version license dist.unpackedSize --json
npm view @types/three@0.182.0 version license dist.unpackedSize --json
```

結果:

| package                    | exact version | license | peerDependencies                        |    unpacked size |
| -------------------------- | ------------- | ------- | --------------------------------------- | ---------------: |
| `@thatopen/fragments`      | `3.4.7`       | MIT     | `three: >=0.182.0`, `web-ifc: >=0.0.77` | 41,668,903 bytes |
| `web-ifc`                  | `0.0.77`      | MPL-2.0 | なし                                    | 23,995,895 bytes |
| `three` (current matrix)   | `0.180.0`     | MIT     | —                                       | 30,764,975 bytes |
| `three` (candidate matrix) | `0.182.0`     | MIT     | —                                       | 36,093,423 bytes |
| `@types/three` (current)   | `0.180.0`     | MIT     | なし                                    |  1,640,565 bytes |
| `@types/three` (candidate) | `0.182.0`     | MIT     | なし                                    |  1,668,967 bytes |

主要 entry/exports:

- Fragments: `main=dist/index.cjs`、`module=dist/index.mjs`、`types=dist/index.d.ts`、`./worker` は
  `dist/Worker/worker.mjs`。
- web-ifc: Node `require`/`node` は `web-ifc-api-node.js`、browser `import` は `web-ifc-api.js`。
  `./web-ifc.wasm`、`./web-ifc-mt.wasm`、`./web-ifc-node.wasm` が export される。
- Fragments は `engines.node >=20.11.0`。probe は Node `22.14.0` で実施した。

### 2. Matrix A — 現行 Three `0.180.0`

実行（`matrix-a-three-0.180` の clean TEMP project、通常 peer resolution）:

```powershell
npm init -y
npm install --ignore-scripts --no-audit --no-fund `
  three@0.180.0 @types/three@0.180.0 `
  @thatopen/fragments@3.4.7 web-ifc@0.0.77
```

結果: exit `1`、`npm ERR! code ERESOLVE`。

```text
Found: three@0.180.0
Could not resolve dependency:
peer three@">=0.182.0" from @thatopen/fragments@3.4.7
```

`--force`/`--legacy-peer-deps` は使っていない。この失敗は peer mismatch の証拠であり、Three `0.180` だけを理由に
Fragments 実装全体を NO-GO とするものではない。candidate matrix と既存 yw-look gate の結果を併せて判断する。

### 3. Matrix B — candidate Three `0.182.0`

実行（`matrix-b-three-0.182` の別 clean TEMP project）:

```powershell
npm init -y
npm install --ignore-scripts --no-audit --no-fund `
  three@0.182.0 @types/three@0.182.0 `
  @thatopen/fragments@3.4.7 web-ifc@0.0.77
npm ls three @types/three @thatopen/fragments web-ifc --all
```

install exit `0`。`npm ls` は次の一つの runtime Three になった。

```text
@thatopen/fragments@3.4.7
  +-- three@0.182.0 deduped
  `-- web-ifc@0.0.77 deduped
@types/three@0.182.0
three@0.182.0
web-ifc@0.0.77
```

ESM import probe:

```powershell
node --input-type=module -e `
  "import * as THREE from 'three'; `
   import * as Fragments from '@thatopen/fragments'; `
   import * as Ifc from 'web-ifc'; `
   console.log(THREE.REVISION, Object.keys(Fragments).includes('IfcImporter'), typeof Ifc.IfcAPI)"
```

結果: `THREE.REVISION=182`、Fragments に `IfcImporter`/`FragmentsModel`/`FragmentsModels` が export され、
`web-ifc` の `IfcAPI` は function。Node ESM 解決と package export は成功した。

### 4. worker/WASM payload と SHA-256

Matrix B の local `node_modules` で `Get-FileHash -Algorithm SHA256` を実行した。source map は payload として数えず、
worker/WASM の実体のみを記録する。

| relative path                                    |     bytes | SHA-256                                                            |
| ------------------------------------------------ | --------: | ------------------------------------------------------------------ |
| `@thatopen/fragments/dist/Worker/worker.mjs`     | 3,267,026 | `B943C3BFD31793B9FDAC0A2ECA94176447D44624173B51C60BCB45834E62050B` |
| `@thatopen/fragments/dist/Worker/worker.min.mjs` | 1,390,368 | `92A7209CA809C5D88A8374C3D3E923949E82C18B9BCC128070C5D32196DC51F9` |
| `web-ifc/web-ifc.wasm`                           | 1,303,940 | `392B547232AA63DF84961D9D3D6E2A7A259CD832B888830CAB2EE30778BF28A0` |
| `web-ifc/web-ifc-mt.wasm`                        | 1,314,227 | `430A2E861F149728D00278CAA871AB23160EA33A1150D71F40205021BE7231E0` |
| `web-ifc/web-ifc-node.wasm`                      | 1,288,859 | `7C52CDCD25C17FD94746015676404008C630AA2C35B51D7977D47A649FDDE936` |

package manifest の `files` には `web-ifc-mt.worker.js` が記載されているが、installed `web-ifc@0.0.77` の実体には
そのファイルが存在しなかった。multi-thread browser path は別途確認が必要である。

remote URL scan:

```powershell
Select-String -Path node_modules/@thatopen/fragments/dist/index.mjs `
  -Pattern 'unpkg|https?://' -CaseSensitive:$false
```

`dist/index.mjs` line 37029（CJS も同じ）に次の実行コードがある。

```js
const url = `https://unpkg.com/@thatopen/fragments@3.4.7/dist/worker/worker.mjs`;
```

これは `FragmentsModels.getWorker()` の実装であり、offline 成功を意味しない。constructor の `workerURL` に同梱
`dist/Worker/worker.mjs` を明示し、WASM も `web-ifc` の local path/URL を明示する設計が必要である。コメントや pako の
license/source URL は hard-coded runtime fetch とは区別した。

### 5. 公式 IFC による web-ifc Node API

`ThatOpen/engine_web-ifc` の公式ファイルを GitHub raw から TEMP に取得した。

| source                                                                                                        |   bytes | SHA-256                                                            | 観測                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------: | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [`test.ifc`](https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/main/test.ifc)                         |  18,636 | `E814B13646A65E596E2771A54E891FE76951603FCF047628B533CD29C4E2A3DD` | IFC2X3、12 lines、geometry なし。`ReadLinearScalingFactor()` warning は出たが API は close まで成功。 |
| [`examples/example.ifc`](https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/main/examples/example.ifc) | 413,681 | `DB372F3F57796E2F572958C1C144BF3D8BE7912493738636A2152CF18F08A14D` | IFC2X3、代表 geometry。                                                                               |

`examples/example.ifc` に対する probe:

```js
const api = new IfcAPI();
await api.Init(undefined, true);
const modelID = api.OpenModel(bytes);
const schema = api.GetModelSchema(modelID);
const line = api.GetLine(modelID, 1, false, false);
const storeys = api.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY, true);
const walls = api.GetLineIDsWithType(modelID, IFCWALL, true);
api.StreamAllMeshes(modelID, callback);
api.CloseModel(modelID);
```

観測値: `modelID=0`、`schema=IFC2X3`、`lineCount=6487`、`storeyCount=2`、`wallCount=17`、
`proxyCount=4`、`meshes=115`、`geometryTotal=119`、`closed=true`、Node exit `0`。これは parser/geometry API の
最小証拠であり、Three renderer、Tauri protocol、IFC4/IFC4x3 の証明ではない。

### 6. Fragments IfcImporter / manager API

Node で次を実行した。

```js
const importer = new IfcImporter();
importer.wasm.path = path.resolve("node_modules/web-ifc") + path.sep;
importer.wasm.absolute = true;
const fragments = await importer.process({ bytes, raw: false });
```

`IfcImporter.process` は `examples/example.ifc` を fragments bytes（この run では `87,603` bytes）へ変換し、exit `0`。
同じ probe の別 run は `87,604`/`87,608` bytesであり、byte-size の完全 deterministic 性はまだ仮定しない。

型/実装の具体的な観測（`node_modules/@thatopen/fragments/dist/index.d.ts`、実装は `dist/index.mjs`）:

- `IfcImporter.wasm: { path: string; absolute: boolean }`、`process({ bytes?, readFromCallback?, readCallback?, raw?, progressCallback? })`。
- `FragmentsModels.getWorker(): Promise<string>` は unpkg fetch。constructor は `workerURL?` と `FragmentsModelsOptions` を受け、
  local URLを明示できる。`load(buffer, { modelId, camera?, raw?, userData?, onProgress?, threadGroup? })` が `FragmentsModel` を返す。
- `FragmentsModels.update(force?)`、`abort(modelId)`、`disposeModel(modelId)`、`dispose()` があり、worker/model ownership の
  explicit seam 候補になる。`maxWorkers` の実測下限は `2`（`1` は `maxWorkers must be ... >= 2`）。
- `FragmentsModel.object: THREE.Object3D` はモデル全体の scene object。`useCamera(camera)`、`dispose()`、
  `getSpatialStructure()`、`getLocalIds()`、`getGuidsByLocalIds(localIds)`、`getItemsByQuery()`、
  `getItemsIdsWithGeometry()`、`getItemsGeometry(localIds)`、`getItem(id)`、`raycast()`/`highlight()` 等がある。
  これは Element ごとの Object3D/userData を保証せず、model/local-id query を selection seam に使う根拠になる。
- worker source/entry は `dist/Worker/worker.mjs`（package export `@thatopen/fragments/worker`）。ブラウザ `Worker` 前提のため、
  Node で `new FragmentsModels(localFileUrl, { maxWorkers: 2 }).load(...)` を試すと
  `ReferenceError: Worker is not defined`（`dist/index.mjs:21252`）で停止した。`IfcImporter` Node 成功から browser/Tauri worker
  成功を推論してはいけない。

### 7. 制限と未検証事項

- candidate Three `0.182.0` は clean probe で package-level compatibility を通しただけで、yw-look の Three upgrade ではない。
  実 repo で `npm run check`、`npm run check:loader-profiles`、`npm run build`、viewport snapshot、visual review を通す必要がある。
- Fragments local worker の Vite/browser loading、network-offline、Tauri custom protocol、WASM locate、camera update/render lifecycle は未検証。
- Fragments `getWorker()` の unpkg path と installed `web-ifc-mt.worker.js` 欠落は、offline pack の payload/entry 設計リスクである。
- 公式 sample は IFC2X3 のみ。IFC4/IFC4x3、巨大 private asset、malformed file の parser/geometry/property evidence は Phase 0B 以降に残る。

## RISKS

1. Three `0.182` upgrade が既存 yw-look の renderer、型、profile、snapshot gate を壊す可能性がある。
2. browser `Worker` と Tauri custom protocol の local URL、CSP、WASM locate が Fragments の Node probe と異なる可能性がある。
3. Fragments の manager/model disposal は共有 material/tile を持つため、generic `disposeObject` との二重破棄を実機 lifecycle で確認する必要がある。
4. `getWorker()` の remote default を誤って使用すると offline 契約違反になる。local worker URL と hash を pack payload の正とする必要がある。
5. package unpacked size は Fragments 約41.7 MB、web-ifc 約24.0 MBであり、core/all profile と NSIS logical checkbox の物理 byte 制限を再確認する必要がある。
6. license は Fragments MIT、web-ifc MPL-2.0。採用 version の notice/source offer を release review で再確認する。

## NEXT

次の最小 slice は **Phase 0B browser/local-worker seam probe** とする。

1. TEMP の candidate Three `0.182.0` probe に Vite/Playwright の最小ページを作り、Fragments の `dist/Worker/worker.mjs` を同梱 URLで
   `new FragmentsModels(localWorkerUrl, { maxWorkers: 2 })` に渡す。`getWorker()` は呼ばない。
2. `IfcImporter` の `web-ifc-node.wasm` ではなく browser 用 `web-ifc.wasm` を同梱 URLで locate し、network deny 下で import →
   `model.object` mount → `useCamera`/`FragmentsModels.update` → `getSpatialStructure`/local-id query → `dispose` を測定する。
3. browser probe が green なら、repo の Phase 0B seam spike（`LoadedPreview.createPackRuntime`、runtime update/selection/dispose ownership）を
   **実装最小差分**で行う。その後に限り candidate Three upgrade を別 slice とし、既存 `npm run check`、loader profiles、build、viewport snapshot、
   visual gate を実行する。
4. local worker/WASM または Three upgrade gate が fail した場合は Fragments を実装開始せず、同じ IFC pack 境界で direct `web-ifc` Three adapter
   の小さな geometry/selection probeへ fallback する。

この evidence は Phase 0A の bounded 判定であり、IFC loader の実装完了、Three upgrade、renderer/Tauri compatibility の承認を意味しない。
