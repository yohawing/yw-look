# IFC Loader Pack 実装計画

> **状態:** Phase 0A/0B、共有ランタイム境界 Phase 0C-1、Three.js `0.182.0` 更新ゲート、IFC optional pack の
> Phase 1 scaffold、ブラウザ Viewer の実 IFC 表示スモークまで完了。selection/property UI、Tauri 実機、fixture、
> release attribution は未完了。

実装作業は `develop` の `3378151` を起点に、専用 worktree `F:\Develop\yw-look-ifc-loader` / branch
`codex/ifc-loader-pack` で進めている。元の `F:\Develop\yw-look` の dirty worktree は変更していない。

## 1. 決定サマリーと成功条件

IFC は first-party の optional `FormatPack`（`id: "ifc-loader-pack"`）として追加する。第一候補は
`@thatopen/fragments` と `web-ifc` の組み合わせで、IFC のパースとメッシュ化を worker 内に閉じる。現行
develop 起点の実装ブランチでは Three.js を `^0.182.0` へ更新済みである。確認済みの現行 Fragments は
`>=0.182.0` を要求するため、依存更新は Phase 0 の候補として検証し、既存 gate を通過した場合だけ採用する。

成功とみなす条件は次のとおり。

- IFC2x3、IFC4、IFC4x3 の代表 fixture をローカル・オフラインで開き、Project → Site → Building →
  Storey → Element の空間階層、選択、限定的なプロパティ表示が一貫する。
- worker と WASM の URL、バージョン、dispose、abort が決定的で、ネットワーク・CDN に依存しない。
- IFC をインストール/有効化していない `core` ビルドには IFC の JS/WASM/chunk がなく、起動と既存 core
  loader の挙動を悪化させない。`all` ビルドでは IFC payload の存在を機械検査できる。
- malformed、巨大 private asset、連続 open/close を含む fixture/gate が理由付きで PASS/FAIL/DEGRADED を
  報告し、視覚 baseline と人間確認を伴う。
- `FormatPack` の境界（`src/packs/` 内実装、registry 経由、viewer/viewport の責務分離）とライセンス記録を
  保ったまま、別の agent がこの文書だけで実装 slice を開始できる。

## 2. 範囲と non-goal

### 今回の範囲

- `.ifc` の preview（`.ifczip` は後述の未解決事項）。
- IFC schema/version の検出、geometry preview、空間階層、選択中 Element の bounded property query。
- optional pack の manifest、offline worker/WASM、`core`/`all` build profile、Settings/Diagnostics の状態。
- fixture、lifecycle/memory/abort/performance/visual の証拠と、NSIS の実際の payload 境界の記録。

### Non-goal

- IFC の編集、書き出し、変換、BIM authoring、完全な quantity takeoff、衝突判定、測量精度の保証。
- native IfcOpenShell/IfcConvert の同梱、Tauri sidecar、dlopen、任意の第三者 JavaScript 実行。
- IFC 全 property の起動時ロード、全要素の常時メモリ常駐、インターネットからの worker/WASM 取得。
- 現行 Three.js を spike の結果なしに一括 upgrade すること、他の loader pack の再設計。
- NSIS checkbox を「個々の pack byte を削除する仕組み」と見なすこと（現在は論理 manifest の enablement）。

## 3. 比較した実装案

| 案                                    | 判定           | 理由 / 条件                                                                                                                                                                                              |
| ------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@thatopen/fragments` + `web-ifc`** | **推奨**       | IFC の geometry/空間モデルの既存処理、Fragments の lifecycle/cache を利用できる。Three 互換、worker API、WASM URL、bundle サイズを Phase 0 で実証してから採用する。                                      |
| 直接 `web-ifc` + Three adapter        | fallback       | Fragments が Three `0.180` と共存できない、または payload/worker が許容値を超える場合。worker で express ID を走査し、`BufferGeometry`/`Group` を自前生成する。実装範囲は広いが、pack 境界は維持できる。 |
| native IfcOpenShell / IfcConvert      | **MVP 不採用** | native toolchain、sidecar 起動、配布/署名、クラッシュ分離、サイズが軽量 preview の目標に反する。将来の offline batch 変換案として別計画にする。                                                          |
| deprecated `web-ifc-three`            | **不採用**     | deprecated API と Three 世代の固定が将来の保守リスク。Fragments または直接 adapter のどちらかに限定する。                                                                                                |

Fallback へ移る場合も `FormatPack` の id/extension/manifest 契約は変えず、geometry backend だけを差し替える。

## 4. Phase 0: 依存・Three 互換性 spike と go/no-go

### 調査対象

- 現行 `three` / `@types/three`（現在 `^0.180.0`）と、候補の Fragments/web-ifc の実際の peer range、
  ESM/CJS、worker、WASM 配布形式を日付付きで記録する。互換性は **二点 matrix**（現行 Three `0.180` と、
  peer 要求を満たす候補 Three `>=0.182`）で測る。
- `@thatopen/fragments` の parser/manager が返す Three object のクラス identity がアプリの Three と同一か確認する。
  二重 Three（`instanceof`、材質/geometry、renderer context の不一致）は不採用理由とする。
- Vite build と Tauri/WebView の custom protocol で、worker がローカル `.wasm` を取得できるか確認する。
- 小さい IFC2x3/IFC4 fixture を parse → mesh → dispose し、既存 viewer の `Group | Mesh`/metadata 契約へ載せられるか確認する。

### 実施方法（依存をリポジトリへ追加しない）

一時ディレクトリに候補を pin して probe project を作る。例:

```powershell
$probeRoot = Join-Path $env:TEMP ("yw-look-ifc-compat-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $probeRoot | Out-Null
foreach ($case in @(@("three-0.180", "0.180.0"), @("three-candidate", "0.182.0"))) {
  $probe = Join-Path $probeRoot $case[0]
  New-Item -ItemType Directory -Path $probe | Out-Null
  Push-Location $probe
  npm init -y
  npm install --ignore-scripts three@$($case[1]) @thatopen/fragments web-ifc
  node -p "require('three/package.json').version"
  npm ls three @thatopen/fragments web-ifc
  Pop-Location
}
```

probe の実行ログと package version は `artifacts/logs/` に保存するが、依存 lockfile や `node_modules` は commit しない。
candidate の exact version は spike 時点で決めて記録する（例では下限の `0.182.0`）。`>=0.182.0` は peer 要求の仮説であり、
実際のリリースで再確認する。

### 必須 gate

1. **Two-point compatibility gate:** 現行 Three `0.180` の peer mismatch は **期待される観測として記録するだけで、
   それ単独では NO-GO にしない**。Fragments が現行 Three で動くなら現行経路を保持する。Fragments の peer 要求を満たす
   candidate `>=0.182` を採用する場合は、candidate を入れた yw-look の実装候補で、既存の rendering/build gate
   （`npm run check`、`npm run check:loader-profiles`、viewport snapshot、`npm run build`、必要な実機 visual review）を
   すべて PASS させる。既存 gate を通らない Three upgrade は Fragments GO としない。
2. **Peer/type/runtime gate:** 採用する matrix point で Fragments の ESM/type と parser/manager の API が成立し、返る Three
   object がアプリの Three と同一である。二重 Three（`instanceof`、材質/geometry、renderer context の不一致）は不採用理由とする。
3. **Runtime gate:** worker から parse/tessellate/transfer/render/dispose が 5 回連続成功し、uncaught error、
   detached buffer、WASM fetch 失敗がない。
4. **Offline gate:** ネットワークを遮断しても同梱 worker/WASM だけで成功し、外部 URL がログに現れない。
5. **Bundle gate:** `core` 出力に IFC の識別 chunk/WASM がなく、`all` 出力には明示的な IFC chunk/WASM がある。
   同じ Three が二重に出力されない。
6. **Lifecycle gate:** 途中 abort、worker terminate、再 open/close 20 回で listener/object URL/geometry/texture
   が解放される。peak memory と first-preview time を測定する。

採用する matrix point で上記をすべて満たしたら Fragments で **GO**。現行 `0.180` が mismatch でも、candidate Three upgrade と
既存 yw-look gate が green なら GO を妨げない。Fragments がどちらの matrix pointでも成立しない、または candidate upgrade が
既存 gate を壊す場合は直接 `web-ifc` adapter を spike し、同じ gate を満たせた場合だけ **FALLBACK-GO**。両案が fail したら
**NO-GO** として IFC pack を保留し、core を変更しない。

### 実施結果（2026-08-06）

- **Phase 0A:** `@thatopen/fragments@3.4.7` + `web-ifc@0.0.77` を固定。Three `0.180.0` は peer mismatch、
  Three/@types `0.182.0` は単一 Three の ESM/Node probe に成功。
- **Repo package graph:** pnpm worktree では `pnpm list three @types/three @thatopen/fragments web-ifc --depth 3`
  が app/optional package とも `three 0.182.0` の単一 runtime を示した（npm の `node_modules/.pnpm` symlink を
  `npm ls` で再検査する gate にはしない）。
- **Phase 0B:** ローカル Worker/WASM を明示した Vite/Playwright probe を3回実行。各回で 134 spatial nodes、
  1319 local IDs、116 geometry IDs、dispose 後 Worker 0、abort 後 Worker 0 を確認。外部URL使用なし。
- **Phase 0C-1:** `LoadedPreview.createPackRuntime`、frame update、resource ownership、例外時 cleanup を共有契約へ追加。
  registry fallback と factory runtime の exactly-once dispose を回帰テストで固定。
- **Three 0.182 gate:** `package.json`、`package-lock.json`、`pnpm-lock.yaml`、FBXLoader vendor、Texture/GPU型、
  shadow enum を更新。vendored checker、TypeScript、focused loader/runtime/lifecycle 66 tests、full 880 tests / 114 files は成功。
- **既存 visual gate の留保:** viewport snapshot は 22 件中 21 件が FLIP PASS。`vmd-tiny-motion` は max
  `0.3545` で失敗したが、baseline は 2026-07-09 作成後に MMD/VMD playback・light-track 修正が入ったままで、
  Three/IFC差分の根拠として baseline を更新していない。現行 branch の既知の stale-baseline red として別タスクへ残す。
- **既存 test-count gate の留保:** `npm run check:test-count` は README の記載（1080 tests / 139 files 等）と
  現行 branch の実測（1149 tests / 147 files、front-end 838、Rust 311、fixture 39）が一致せず失敗する。IFC差分の
  カウント漏れではないため、README更新を別タスクへ残す。
- **Phase 1 scaffold:** `ifc-loader-pack` を registry/Settings definition に登録し、`@thatopen/fragments@3.4.7` +
  `web-ifc@0.0.77` を optional dependency として alias 経由で lazy load する実装を追加した。installed 側は
  local worker/WASM URL、`IfcImporter`、`FragmentsModels`、camera/update/dispose runtime を接続し、未導入側は
  actionable error を返す。Fragments の初回 `update(true)` を mount 前に完了させ、visible tile geometry を generic
  viewport の framing/metadata が取得できるようにした。unit tests は loader/runtime/pack/unavailable を含む。
  IFC の importer process 自体は現状 main thread で、Fragments model update のみ worker-backed であるため、大規模モデルの
  freeze は未解決とする。Fragments model load 中の `AbortSignal` は `manager.abort(modelId)` へ伝播し、runtime の
  frame update は in-flight を一つに直列化するが、parser 実行中の abort と async manager dispose の完了待ちは未解決である。
  `PackRuntime` の pack-owned GPU resource と viewer が追加する wireframe/temporary material の所有権分離も次 slice で必要とする。
- **Profile gate:** `npm run check:loader-profiles` は core/all とも成功。core は IFC chunk/worker/WASM を含まず、all は
  `ifc-loader-pack` chunk（約 4.1 MiB）、Fragments worker（約 3.2 MiB）、`web-ifc.wasm`（約 1.3 MiB）を含むことを
  機械検査した。
- **ブラウザ Viewer smoke (2026-08-06):** Vite `127.0.0.1:1420` 上で Playwright/Chromium に公式 IFC2x3 `example.ifc`
  (413,681 bytes) を file chooser から投入し、`Model loaded: example.ifc`、5 meshes、3 materials、0 textures、0 warnings、
  `Grid: 1 m` を確認した。初回の tile materialization、camera framing、canvas render を同一 run で確認し、外部 request は 0 件。
  人間目視でも建物形状が表示されることを確認した。証跡 screenshot は
  `artifacts/screenshots/ifc-viewer-smoke.png`（ignored local artifact）に保存した。Chromium の SwiftShader による
  `ReadPixels` performance warning は出たが、load failure ではない。
- **未完了:** viewport visual snapshot、人間の視覚確認（正式 baseline/sign-off）、Tauri custom protocol、IFC4/IFC4x3・large private fixture、
  spatial/selection/property adapter、license attribution。したがって判定は **conditional GO（Phase 1 scaffold のみ）**
  であり、IFC Pack 完了のGOではない。

## 5. FormatPack、選択、metadata/property の進化

### Pack の境界

実装先は次のテンプレートに限定する。

```text
src/packs/ifc-loader-pack/
  pack.ts                 # FormatPack identity / lazy entry
  loader.ts               # viewer から呼ばれる thin facade
  worker/ifc.worker.ts    # parse/tessellate/property request
  runtime.ts              # worker channel、abort、dispose、cache
  metadata.ts             # bounded summary と schema diagnostics
  ui/                     # IFC metadata/property card（必要になった場合）
  types.ts
  __tests__/
```

core は `src/packs/index.ts` の登録集約点だけを import し、pack から `app/`、`components/`、`stores/` を直接 import しない。
`src/viewer/` は `LoadedPreview`/`SceneContext` を返すだけ、React 統合は `src/viewport/` 側で行う。

### Phase 0 で検証する最小 shared seam 仮説

これは承認済み API ではなく、Fragments の実体と現行 mount の挙動を突き合わせてから採否を決める spike 仮説である。現行 mount は
traversal/material/shadow/metadata helper を無条件に適用するため、extension 名の分岐で逃げず、次の最小面を検証する。

- `LoadedPreview.createPackRuntime` factory（仮）で loader が model/manager/worker handle を mount へ渡す。
  `SceneContext.ifcModel` や `userData.ifc` のような core/Three への埋め込みは増やさない。
- `PackRuntime.update(frame)`（仮）を render 前に呼び、`model.useCamera` / `fragments.core.update` と fly-camera の更新順序を
  互換にする。frame の型と呼び出し位置は既存 animation loop で実測する。
- optional な `PackRuntime.selection` adapter（仮）は pack-neutral な stable key と lazy inspect を返す。Fragments の
  model/local-id query をここに閉じ、direct adapter も同じ中立 key を返す。
- mounted resource の ownership を runtime に明示し、runtime が所有する manager/worker/geometry/material を generic
  `disposeObject` が二重破棄しない。dispose の責任表と lifecycle test を先に作る。
- `skipScaleNormalization` と capability-based suppression で unsafe な generic mutation（traversal/material/shadow 等）を抑制し、
  拡張子チェックを追加して回避しない。

この seam 仮説は Phase 0/1 の実装候補であり、Fragments が batch object を返す場合の selection、fly-camera、dispose を含む実機 gate を
満たせない限り `FormatPack` の正式 API に昇格しない。

### Selection と spatial hierarchy

- worker の IFC relationship を Project → Site → Building → Storey → Element（`IfcWall`、`IfcSlab`、`IfcDoor` 等）へ
  正規化する。複数 project、orphan element、未対応 relationship は synthetic root と warning に逃がし、黙って捨てない。
- Fragments は複数 Element を一つの render object に batch する可能性があるため、**Element ごとに Object3D が一つあること、
  または `userData.ifcExpressId` を各 mesh に付けられることを前提にしない**。Fragments の model/local-id selection/query API で
  local id → express id/type/spatial path を解決し、その mapping を選択詳細と property reader に渡す。
- per-object `userData.ifcExpressId`/`ifcType`/`ifcSpatialPath` は、Element 単位の object mapping を保証できる直接
  `web-ifc` Three adapter の fallback に限って使う。core に `ifc` 文字列の分岐を追加せず、選択詳細は pack dispatch で解決する。
- `IfcProject`/空間 node は必要なら non-rendering hierarchy node とする。Fragments の batch mapping でも Element が hierarchy/property
  から確認できることを優先し、geometry が無い Element を黙って消さない。

### Metadata と property hook

初期 summary は次の判別 union を想定する（実装時に既存型と調整する）。

```ts
type IfcPackMetadata = {
  kind: "ifc";
  schema: "IFC2X3" | "IFC4" | "IFC4X3" | "unknown";
  projectCount: number;
  spatialRoots: Array<{ expressId: number; name: string | null; type: string }>;
  counts: Record<string, number>;
  units: string[];
  warnings: string[];
};
```

`collectMetadata`/`MetadataCard` は summary のみを扱い、全 entity property を同期的に展開しない。worker runtime が
`IfcPropertyReader` を保持し、選択時に `expressId` を受けて遅延 query する。

- 1 query は property set/quantity を最大 256 行または 64 KiB（小さい方）に制限し、`nextCursor`/`truncated` を返す。
- cache は express ID の LRU（上限 128 件を初期値）とし、pack dispose で全破棄する。起動時の全 property preload はしない。
- property の型・単位・未解決 reference を保持し、文字列化で失われた情報を Diagnostics に残す。
- 新しい汎用 hook は直ちに `FormatPack`へ足さない。まず pack 内の `IfcPropertyReader` と
  `src/packs/index.ts` の dispatch で実証し、2 pack 以上が同じ需要を持った時点で
  `createPropertyProvider`（bounded query、abort、dispose を必須とする）へ昇格する。
- MMD の selected-object details は既に第二の consumer なので、「IFC 一個だけ」の根拠で selection/details hook を後回しにしない。
  Phase 0/1 で既存 MMD dispatch と IFC の model/local-id mapping を比較し、generic `PackObjectDetailsProvider`（bounded query、
  abort、dispose を含む）を今から一般化するか、当面 pack dispatch に留めるかを明示的に決める。どちらの場合も core の
  `ObjectInfo` を IFC 専用化しない。

## 6. Worker/WASM と配布の真実

- parser/tessellator と Fragments runtime は worker 内で実行し、メイン thread へ transferable な geometry、metadata、
  diagnostics だけを返す。worker は request id、`AbortSignal` 相当の cancel message、timeout、terminate fallback を持つ。
- `web-ifc.wasm`（および Fragments が要求する worker/runtime asset）は pack の同梱 payload とし、manifest/loader が参照する
  URL は app-managed directory または Tauri resource のローカル URL に限定する。CDN、runtime `fetch` の外部 origin、暗黙の
  `importScripts` は許可しない。
- pack manifest は既存形状（`id`, `name`, `version`, `minimumAppVersion`, `extensions`, `entry`, `kind`）に合わせ、
  必要なら `assets`/integrity を内部拡張する。manifest が無い/不整合/worker/WASM が無い場合は core を壊さず
  `missingOptionalLoader` または `incompatibleOptionalLoader` と Diagnostics warning にする。
- Fragments は MIT、web-ifc は MPL-2.0 として扱う（実際に採用する version の LICENSE/NOTICE を配布物で再確認）。
  `THIRD_PARTY_NOTICES.md`、生成 license attribution、About/Diagnostics の表示、MPL の notice/source offer を release gate にする。
  これは法的助言ではなく、最終配布前に license review を受ける。

### core/all profile

現行 profile runner は `YW_INCLUDE_MMD_LOADER_PACK` / `YW_INCLUDE_SPARK_LOADER_PACK` だけを切り替える。IFC を追加する実装では
同じ機構で `YW_INCLUDE_IFC_LOADER_PACK=0/1` を定義し、Vite alias と manual chunk を IFC entry/worker/WASM に適用する。

- `npm run build:core` / `check:loader-profile:core`: IFC JS、worker、WASM、Fragments chunk が存在しないことを検査する。
- `npm run build:loaders` / `check:loader-profile:loaders`: IFC chunk/WASM が存在し、unavailable shim が出ないことを検査する。
- `core` の静的 bundle と起動時 registry は軽量なまま、optional pack は最初の IFC open 時まで import/初期化しない。
- `all` は payload を含む配布 profile であり、全ユーザーが使用するとは限らない。サイズ、parse、WASM init を記録する。

### NSIS の checkbox 制限

現在の `tauri.windows.loaders.json` + `optional-loader-packs.template.nsh` は、NSIS custom page で manifest/loader stub を
app-managed `optional-loaders/*` に書き、pack の `installed/enabled` を論理的に切り替える。`bundle:win:loaders` が生成した
signed app bundle 内の個別 IFC/Fragments bytesを、checkbox の unchecked だけで物理削除する仕組みではない。

したがって実装時の約束は「core build には byte がない」「all build には byte がある」「NSIS checkbox は manifest と runtime
availability を制御する」である。unchecked 時に installer byte も減らす必要が生じた場合は、pack ごとの resource/archive 分割または
Settings からの後続ダウンロードを別設計し、今回の slice の成功条件に混ぜない。

## 7. 実装 Phase、成果物、検証

### Phase 0 — 互換性/サイズ spike（最優先）

- **成果物:** temporary probe、version/peer range、Three duplicate 調査、worker/WASM offline log、Fragments GO または
  direct web-ifc FALLBACK/NO-GO の記録。MMD の selected-object details を第二の consumer として、generic
  `PackObjectDetailsProvider` を今から一般化するか pack dispatch に留めるかの初期判断も残す。
- **影響面:** 依存候補、Vite worker/WASM 解決、Three runtime のみ。repo の dependency file は変更しない。
- **完了条件:** §4 の全 gate と、IFC2x3/IFC4 の tiny parse/dispose が再現可能。
- **検証:** `npm ls three @thatopen/fragments web-ifc`（probe）、ネットワーク遮断 probe、peak memory/first preview 測定。

### Phase 1 — Pack scaffold と registry seam

- **成果物:** `src/packs/ifc-loader-pack/` の pack/loader/types、`FormatPack` 登録、optional manifest/status、未導入/無効/非互換の feedback。
- **完了条件:** IFC は core branch なしで `missingOptionalLoader` → installed/enabled → `incompatibleOptionalLoader` を再現し、
  既存 pack の boundary checker が通る。MMD/IFC の selection/details seam と generic hook の採否が実装前に明文化される。
- **検証:** `npm run check:format-pack-boundaries`、`npm run check:viewer-viewport-boundaries`、対象 Vitest。

### Phase 2 — Offline worker/WASM loading

- **成果物:** worker channel、local asset URL、abort/timeout/terminate、pack runtime dispose、WASM license/manifest metadata。
- **影響面:** `vite.config.ts` の optional alias/chunk、profile runner/checker、`src/packs` のみ（後で NSIS hook に接続）。
- **完了条件:** 外部 network なしで parse request が完了し、途中 abort 後に次の open が成功、object URL/worker が残らない。
- **検証:** worker unit test、offline Playwright/Tauri smoke、`npm run typecheck:ts`、profile build/check。

### Phase 3 — Geometry と空間階層

- **成果物:** Fragments backend（または fallback adapter）、Project/Site/Building/Storey/Element grouping、units/axis/scale、
  orphan/missing geometry diagnostics。
- **完了条件:** IFC2x3/IFC4/IFC4x3 の各 fixture が非 blank の preview と安定 express ID を返す。unsupported entity は warning 付きで継続する。
- **検証:** pack loader tests、`npm run test:viewport-snapshot` baseline、実画面 screenshot、人間の visual sign-off。

### Phase 4 — Summary、selection、lazy properties

- **成果物:** `IfcPackMetadata`、MetadataCard、selection dispatch、bounded `IfcPropertyReader`（cursor/truncation/cache）。
- **完了条件:** selected Element の property set/quantity が 256 行/64 KiB 上限内で表示され、未選択の全件 query が発生しない。
- **検証:** property pagination/abort/cache unit tests、E2E で Element 選択 → query → deselect/dispose、Diagnostics の truncation。

### Phase 5 — Profile/manifest/NSIS 接続

- **成果物:** `YW_INCLUDE_IFC_LOADER_PACK`、core/all checker、IFC manifest、Settings state/extension registration、NSIS hook の IFC
  logical checkbox、license attribution。
- **完了条件:** core artifact から IFC bytes が消え、all artifact に存在する。NSIS の unchecked は manifest/availability のみを変え、
  その制限がテスト/ドキュメントに明示される。
- **検証:** `npm run check:loader-profiles`、`npm run prepare:nsis-loader-packs`、`npm run check:nsis-loader-packs`、
  `npm run check:file-associations`、生成 bundle があれば `npm run check:nsis-loader-pack-bundle`。

### Phase 6 — Fixture、lifecycle、性能、視覚 gate

- **成果物:** §8 の fixture catalog/manifest、malformed diagnostics、private asset 手順、memory/abort/perf report、visual baseline。
- **完了条件:** 代表 corpus、private 大規模 asset、20 回 open/close、mid-parse abort、network-offline、core startup regression を
  一つの再現可能なコマンド群で実行できる。green smoke だけでなく degraded/fail の理由も保存する。
- **検証:** `npm run test`、`npm run test:viewport-snapshot`、`npm run test:fixtures`（private は `npm run test:fixtures:private`）、
  `npm run bench:load`/targeted IFC harness、`npm run build:core` と `npm run build:loaders`、human screenshot review。

### Phase 7 — Release hardening

- **成果物:** `THIRD_PARTY_NOTICES.md`/license attribution、README/Settings の offline/optional 説明、rollback 手順、release gate log。
- **完了条件:** MPL/MIT notice と source offer を含む配布物、署名後の manifest/payload 検査、既存 core update/uninstall で pack directory
  が契約どおり保持/削除される。
- **検証:** `npm run generate:license-attributions`、`npm run check`、Windows clean install/update/uninstall、Diagnostics の実機確認。

## 8. Fixture と証拠マトリクス

fixture は生成元・schema・期待値・license を `samples/manifest.json`（private は ignored catalog）から追跡する。上流 asset を
無断再配布せず、最小ケースは自作/生成する。

| 区分          | 内容                                                                                                 | 期待する観測                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| IFC2x3        | Project/Site/Building/Storey、Wall/Slab/Door、material/units                                         | schema 検出、階層、mesh、express ID、bounded properties                                |
| IFC4          | PropertySet/Quantity、複数 Element、material/texture 参照                                            | property pagination、unit表示、missing reference warning                               |
| IFC4x3        | インフラ系の最小要素（実装が未対応なら明示 degraded）                                                | parser が crash せず、対応範囲と unsupported entity を表示                             |
| malformed     | header/schema 不正、途中 truncate、壊れた relationship、geometry 無し、（将来 `.ifczip` の壊れ zip） | `loadFailed`/`missingReference` と具体的 code、worker terminate、core 継続             |
| large private | 配布しない実務 BIM（`samples/private` の manifest と hash/サイズだけ）                               | peak worker/WASM/JS memory、parse/first preview、property query latency、visual sanity |

必須 evidence:

- **Lifecycle:** open → mount → select → deselect → close を 20 回、worker count/listener/object URL/Three resource の差分を記録。
- **Abort:** parse/tessellate/property query の各段階で abortし、次の open が成功、partial object が scene に残らないことを確認。
- **Memory:** fixture 別の peak RSS/JS heap/WASM heap と dispose 後の残留を測定。閾値は Phase 0 baseline の p95 + 20% を初期 gate とし、
  大型 private は別上限を合意する。
- **Performance:** cold core startup に IFC install の有無で差がないこと、IFC first preview の import/parse/mesh/upload を分解して記録。
  baseline 比 2 倍超または user-facing freeze があれば NO-GO/再設計とする。
- **Visual:** IFC2x3/4/4x3 と large private を同一 camera/light で screenshot（`artifacts/screenshots/`）し、blank、軸、単位、
  z-fighting、透明材質、階層表示を人間が確認する。snapshot/数値だけで視覚 parity を承認しない。

## 9. リスク、rollback、再検討 trigger

### 主なリスク

- Three peer mismatch、二重 Three、Fragments API の breaking change。
- web-ifc/Fragments の WASM URL が Tauri/WebView の CSP/custom protocol で解決できない。
- IFC schema/relationship の多様性、instancing、unit/axis、geometry 欠落による誤った preview。
- 大型 BIM の worker/WASM heap 枯渇、property 全件展開による UI freeze、abort 漏れ。
- MPL-2.0 notice/source offer、private asset の再配布範囲、NSIS の logical/physical payload 誤解。

### Rollback / fallback

- Phase 0 NO-GO なら dependency/lockfile を変更せず、`ifc-loader-pack` を registry に登録しない。既存 core loader をそのまま出荷する。
- Fragments 導入後に実機/性能 gate が fail した場合は、同じ manifest/id の direct `web-ifc` adapterへ戻す。adapter も fail なら pack を
  `incompatibleOptionalLoader` として無効化し、診断と再現ログだけを残す。
- worker/WASM、property reader、UI、profile/NSIS は別 slice に分け、各 slice は `git diff`、対象テスト、境界 checker を通してから次へ進む。
  本計画の実施時も commit/push は担当者の承認後に行い、失敗した試行を成功扱いにしない。

### 計画を再検討する trigger

- Fragments が Three `0.180` を正式にサポートする、または要求が `0.182+` からさらに変わる。
- probe で duplicate Three、offline worker/WASM、bundle、memory、first-preview gate が一つでも基準外。
- IFC4x3 fixture または大規模 private asset で階層/geometry/property が silent fallback になる。
- pack install/update と NSIS の physical payload が製品要件として必要になる。
- property/selection hook を第二の packも要求し、generic `FormatPack` contract へ昇格する価値が出る。

## 10. 未解決の質問（実装開始前に owner が決める）

1. 初期 extension は `.ifc` のみか、`.ifczip`（zip 展開とサイズ上限）を同じ pack で扱うか。
2. `@thatopen/fragments` と `web-ifc` の exact version、Three upgrade を許可するか、direct adapter を先に採るか。
3. IFC property card の UI slot と、generic property provider を `FormatPack` に昇格する時期。
4. IFC4x3 の必須 entity/relationship/geometry 対応範囲と、unsupported の表示分類。
5. worker/WASM を signed app resource に置くか、app-managed optional directory に置くか。Settings install の source、hash、更新/rollback 方針。
6. `core`/`all` の物理 payload方針（NSIS checkbox は論理のみでよいか、pack ごとの別 archive が必要か）。
7. MPL-2.0 notice/source offer の社内レビュー担当と、private fixture の配布/CI 可否。
8. unit/axis/precision、instancing、texture/sidecar、multi-file IFC project を MVP でどこまで保証するか。

## 11. review/commit 単位の実装 slices（進捗付き）

各 slice は一つの目的、対象テスト、差分レビューを持つ。順序を飛ばして依存を追加しない。

1. **IFC-00 Compatibility probe（完了）:** 依存を repo に入れず GO/FALLBACK/NO-GO と数値 baseline を記録。
2. **IFC-01 Pack seam（完了）:** `FormatPack` scaffold、registry/status/feedback、未導入 shim。既存 loader の regression gate。
3. **IFC-02 Worker/WASM（部分完了）:** local asset URL、runtime camera/update/dispose、初回 tile materialization、Fragments load abort、
   core/all chunk checker と unit test、ブラウザ Viewer smoke を追加。importer の worker 化、parser 中 abort、dispose barrier/timeout、
   pack/viewer resource ownership の分離、Tauri/offline 実機は未完了。
4. **IFC-03 Geometry/spatial:** backend adapter、Project→Element tree、express ID、units/axis、malformed diagnostics。
5. **IFC-04 Selection/metadata:** summary union、MetadataCard、selection dispatch、bounded lazy property reader/cache。
6. **IFC-05 Packaging:** manifest/Settings enablement、file association、NSIS logical checkbox、license attribution。physical byte の主張はしない。
7. **IFC-06 Evidence:** IFC2x3/4/4x3、malformed、private large、lifecycle/memory/abort/perf/visual corpus と scripts。
8. **IFC-07 Release hardening:** clean install/update/uninstall、signed artifact、NOTICE/source offer、rollback/revisit log。

この計画自体は IFC 実装完了を意味しない。完了判定は各 slice の gate と owner の human/配布レビューが揃った時点に限る。
