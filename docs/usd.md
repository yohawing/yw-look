# USD 対応 設計・記録ドキュメント

`yw-look` の USD サポートを Phase ごとに記録する。方針決定・実装記録・次フェーズの計画をこのファイルに一元管理する。

---

## Phase 0 — PoC（完了）

### 目的

Rust 側 inspector の実装基盤として `mxpv/openusd` (`openusd 0.2.0`) が使えるかを fork する前に確認する。

判断したいこと:

- USDA / USDC / USDZ が現実のアセットで読めるか
- composition (`references` / `payloads` / `subLayers`) が動くか
- Windows MSVC でビルドが通るか
- `inspect_stage` / `summarize_stage` / `collect_asset_issues` を組める API があるか

### 検証環境

- OS: Windows 11
- Toolchain: `rustc 1.94.0` / `cargo 1.94.0` (stable-x86_64-pc-windows-msvc)
- Crate: `openusd = "0.2"` (released 2026-04-06)
- PoC コード: `experiments/usd-poc/`（yw-look 本体から隔離した独立 Cargo project）

### ビルド事情

- `openusd 0.2` の依存ツリーは **pure Rust のみ**（C++ FFI / bindgen / cmake なし）
- Windows MSVC で build / run まで成功
- yw-look の配布要件（インストーラ同梱、C++ ランタイム不要）と相性が良い

### 検証アセット

| ID                          | パス                                                          | 形式                          | 性質                                 |
| --------------------------- | ------------------------------------------------------------- | ----------------------------- | ------------------------------------ |
| `usda-tiny-sanity`          | `samples/assets/usd/tiny.usda`                                | USDA 単体                     | 自作 sanity asset                    |
| `usd-kitchen-set`           | `samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd` | USDA root + USDC `*.geom.usd` | Pixar Kitchen Set                    |
| `usd-kitchen-set-instanced` | `Kitchen_set_instanced.usd`                                   | USDA + native instancing      | `instanceable = true` を使う variant |
| `usdz-arkit-chameleon`      | `chameleon_anim_mtl_variant.usdz`                             | USDZ (ZIP)                    | Apple AR Quick Look サンプル         |
| `usdz-arkit-glove`          | `glove_baseball_mtl_variant.usdz`                             | USDZ (ZIP)                    | Apple AR Quick Look サンプル         |

### 結果マトリクス

| アセット                          | `Stage::open` | `default_prim`     | `layer_count` | `root_prims` | traverse 完走 prim 数 |
| --------------------------------- | ------------- | ------------------ | ------------- | ------------ | --------------------- |
| `tiny.usda`                       | ✅            | `"Root"`           | 1             | 1            | 2                     |
| `Kitchen_set.usd`                 | ✅            | `"Kitchen_set"`    | **229**       | 77           | **2048**              |
| `Kitchen_set_instanced.usd`       | ❌            | —                  | —             | —            | —                     |
| `chameleon_anim_mtl_variant.usdz` | ✅            | `"Root"`           | 1             | 1            | 203                   |
| `glove_baseball_mtl_variant.usdz` | ✅            | `"glove_baseball"` | 1             | 1            | 67                    |

`Kitchen_set_instanced.usd` の失敗原因: USDA parser が `instanceable = true` を未認識。upstream PR 1 本で塞げる粒度。

### 判定: **Go**

Phase 1 へ進む。

### 再現手順

```sh
cd experiments/usd-poc
cargo run --release
```

---

## Phase 1 — Rust バックエンド（完了）

### 実装内容

- `UsdBackend` trait (`src-tauri/src/usd/backend.rs`) — 抽象境界
- `OpenusdBackend` — `yohawing/openusd` fork を呼ぶ薄いアダプター
- Tauri command: `inspect_stage` / `summarize_stage` / `collect_asset_issues`
- wire 型: `StageInspection` / `StageSummary` / `AssetIssue` / `CompositionArc`
- `inspectStage` で `metersPerUnit` ヒントを Three.js ビューアに渡し極小表示を補正

### fork で追加した API（`yohawing/openusd`, branch: `yw-look-phase1`）

| 追加 API                          | 内容                          |
| --------------------------------- | ----------------------------- |
| `stage.up_axis()`                 | `enum UpAxis { Y, Z }` を返す |
| `stage.meters_per_unit()`         | `f64` を返す                  |
| `stage.references_in(path)`       | composition arc の列挙        |
| `stage.payloads_in(path)`         | 同上                          |
| `stage.unresolved_assets()`       | 解決失敗アセットのリスト      |
| `instanceable` prim metadata 対応 | USDA parser の認識キー追加    |

### Exit rule

upstream PR 5 本のうち過半が 3 ヶ月以内に merge されない、もしくは USDC 系のクリティカルな破綻が判明した場合 → fork 常用をやめ、`yw-look/src-tauri` 側に必要最小限の inspector を inline で持つ方針に切り替える。

---

## Phase 2 — UX 反映（完了）

### 目的

Phase 1 で実装した Rust コマンドをフロントエンドに反映し、読み込み体験を「重い parse を待たせきり」から「まずサマリを見せて parse は後追い」に変える。

### 達成条件（すべて完了）

1. ✅ USD 開封と同時に `summarize_stage` / `inspect_stage` / `collect_asset_issues` を並列実行し UsdInspectorCard に表示
2. ✅ `collect_asset_issues` の結果を既存 WarningsCard に合流
3. ✅ `USDLoader.parse` 前に `rAF + setTimeout(0)` で 1 フレーム譲りサマリを先に paint
4. ✅ USDC バイナリ検出時に明示エラーを出す（黙って空描画になるのを防ぐ）
5. ✅ Web Worker scaffold を `VITE_USD_WORKER=1` で有効化できる状態で用意（default OFF）

### 読み込みパイプライン設計

```
currentFile 変更
 ├─ (A) App 側: summarizeStage + inspectStage + collectAssetIssues を parallel 実行
 │     → UsdInspectorCard / WarningsCard が即座に更新される
 └─ (B) AssetViewport 側: loadPreviewObject → yieldToPaint() → USDLoader.parse
        → USDA のみ成功。USDC は明示エラー
```

### 判明した Three.js USDLoader の限界

| ファイル種別     | 3D プレビュー | USD Inspector |
| ---------------- | ------------- | ------------- |
| USDA テキスト    | ✅            | ✅            |
| USDZ (USDA root) | ✅            | ✅            |
| USDC バイナリ    | ❌ 明示エラー | ✅            |
| USDZ (USDC root) | ❌ 明示エラー | ✅            |

USDC の 3D 描画は Three.js では不可能。Phase 3 で Rust → カスタムバイナリ → 専用 Loader パイプラインで対応する。

### Web Worker スケルトン（`VITE_USD_WORKER=1`）

- `src/workers/usdLoader.worker.ts` — USDLoader.parse → `Group.toJSON()` を worker 内で実行
- `src/viewer/usdWorkerLoader.ts` — worker 呼び出し + `ObjectLoader` 再構築 wrapper
- 失敗時は同期 parse にフォールバック。binary buffer は `slice(0)` でコピーして渡す（transfer で detach しない）
- toJSON/fromJSON の material 再現度は Phase 3 で検証してから正式 ON にする

---

## Phase 3 — Rust Geometry パイプライン（完了）

### 目的

USDC バイナリ（Kitchen Set の `.geom.usd` 等）と、外部 layer を持つ USDA を 3D で表示できるようにする。`yohawing/openusd` fork に geometry 取得 API を追加し、Rust 側で GLB バイナリを生成して Three.js `GLTFLoader` に渡す。

`references` / `payloads` は通常どおり compose した状態で扱う。payload の deferred load / unload 制御は Phase 4 へ分離する。

### 転送フォーマット: GLB + `ipc::Response`

| 方式                      | 判断                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| JSON                      | float 配列が文字列化され 3〜4 倍のサイズ → 除外                     |
| `Vec<u8>` IPC             | serde_json が整数配列にシリアライズし同様に肥大化 → 除外            |
| カスタムバイナリ (YWLD)   | 独自仕様の維持コストが大きい。ボトルネックは USD traverse 側 → 除外 |
| **GLB + `ipc::Response`** | 標準フォーマット・`GLTFLoader` 再利用・外部ツールで検証可能 → 採用  |

`ipc::Response` で GLB バイナリを JSON シリアライズせずそのまま `ArrayBuffer` として JS 側に渡す。

**実装ノート**: `gltf` crate は採用せず、`serde_json::json!` で GLTF JSON を組み立てて GLB binary container を手書きする方式にした（`src-tauri/src/usd/glb.rs`）。依存を最小化でき、`accessor.min/max` や stride 計算も自前で完結する。

### 分岐判定: `requires_glb_preview()`

拡張子ではなく **stage の実体** で分岐する。`.usdz` は ZIP コンテナであり、root layer が USDA / USDC どちらの場合もある。

```
USD ファイル開封（usda / usd / usdc / usdz すべて同じパス）
  └─ Rust: Stage::open() → requires_glb_preview(path) で判定
       ├─ false → USDLoader.parse（既存の Three.js 経路）
       └─ true  → extract_geometry(path) → GLB バイナリ
            └─ ipc::Response → invoke<ArrayBuffer>()
                 └─ GLTFLoader.parseAsync(buffer, "") → Group
```

`requires_glb_preview()` は以下のいずれかで true を返す:

1. **root layer が USDC バイナリ** — Three.js USDLoader は USDC を読めない
2. **composed layer_count > 1** — yw-look は単一テキストバッファしか USDLoader に渡さないため、`references` / `payloads` / `subLayers` を持つ USDA も JS 側では空描画になる。GLB パイプラインは fork 側で fully-composed stage を扱うため composition arc を透過的に解決できる

Ball.usd（USDA root + payload chain → USDC leaves）のようなケースは、この 2 番目のルールで GLB 経路に乗る。

### IPC 転送

```rust
use tauri::ipc::Response;

#[tauri::command]
async fn extract_geometry(
    backend: State<'_, UsdBackendState>,
    path: String,
) -> Result<Response, String> {
    let glb: Vec<u8> = run_blocking_usd(move |b| b.extract_geometry_glb(path.as_ref()))?;
    Ok(Response::new(glb))
}
```

### パイプライン全体

```
USD ファイル (USDC root または composition あり USDA)
  └─ Rust: openusd fork で Stage::open() → pcp 合成済み Stage
       └─ 2-pass traverse:
            (1) renderable な Mesh prim を収集
                 ├─ is_renderable_mesh: active / visibility / purpose を親方向に継承チェック
                 └─ mesh_of(path): points / indices / counts / normals / uvs を一括取得
            (2) 各 Mesh の world matrix を yw-look 側で合成
                 ├─ compose_prim_local_xform: xformOpOrder を走査
                 │    - matrix4d / translate / scale
                 │    - rotateX/Y/Z / rotateXYZ〜ZYX（Euler 三つ組）
                 │    - orient（quaternion）
                 │    - !invert! プレフィクス（Maya pivot pair 対応）
                 │    - !resetXformStack! 尊重
                 └─ 親 prim を辿って local を掛け合わせ world を構築
  └─ Rust: Z-up → Y-up 補正行列を pre-multiply（upAxis が Z の場合）
  └─ Rust: triangulate（quad/ngon fan、orientation 応じた winding 反転）
  └─ Rust: build_glb() で GLB バイナリ生成
  └─ Tauri IPC: ipc::Response（JSON シリアライズなし）
  └─ JS: GLTFLoader.parseAsync(buffer, "") → Three.js Group
```

### fork に追加した API（`yohawing/openusd`, branch: `yw-look-phase3`）

Phase 3 では fork を `main` に再ベースし、Phase 1 改造を再 port した上で Phase 3 API を追加している。

| API                               | 内容                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `stage.root_layer_is_binary()`    | root layer が USDC バイナリかどうか                                                       |
| `stage.mesh_of(prim_path)`        | `MeshData { points, face_vertex_indices, face_vertex_counts, normals?, uvs? }` の一括取得 |
| `stage.local_xform_of(prim_path)` | 単 prim の local matrix（**未使用**。yw-look 側で `compose_prim_local_xform` を実装）     |

計画段階の `meshes_in / normals_in / uvs_in / xform_of` は `mesh_of` に統合した。

### yw-look 側で実装した補助層

fork 側の API が粗い部分は yw-look 側で補完している:

| 役割                                         | 実装場所                                                          |
| -------------------------------------------- | ----------------------------------------------------------------- |
| 親方向の xform 合成                          | `OpenusdBackend::compose_world_xform`（`!resetXformStack!` 尊重） |
| xformOp 順序付き合成（invert 対応）          | `OpenusdBackend::compose_prim_local_xform`                        |
| xformOp:orient / rotate / scale / matrix4d   | `build_xform_op_matrix`、`read_quat`、`quat_to_mat4`              |
| 4x4 逆行列                                   | `invert_mat4`（cofactor）                                         |
| Z-up → Y-up 補正                             | `z_up_to_y_up_mat4`                                               |
| 可視性 / purpose / active の継承判定         | `is_renderable_mesh`（親チェーン walk）                           |
| rightHanded / leftHanded 判定と winding 反転 | `MeshOrientation` + `mesh_data_to_input`                          |
| uniform / constant primvar の展開            | `AttrKind` 分類                                                   |
| face-varying → vertex-varying 展開           | `mesh_data_to_input`                                              |
| GLB バイナリ組み立て                         | `src-tauri/src/usd/glb.rs`                                        |

### Phase 5 に延期した項目

- ~~**`material_of()` (UsdPreviewSurface PBR)**~~ — Phase 5a で scalar factor のみ対応済み（`Stage::material_of` を fork に追加、1 hop の UsdUVTexture connection 解決、GLB は `materials[]` 配列として出力）。diffuse texture embedding / multi-hop shader graph は Phase 5b+ へ繰越
- ~~**凹 n-gon の ear-clip triangulation**~~ — Phase 5 先行で対応済み（`triangulate_polygon`、`openusd_backend.rs`）。Newell の法線計算 → 主成分軸を drop した 2D 射影 → 符号付き面積で CW/CCW 判定 → ear-clip。数値縮退時は fan にフォールバック。triangle / convex quad は同じ経路で高速パスに乗る

**副作用として受け入れた項目**: 外部 layer を持つ USDA も GLB 経路に流れるため、USDLoader が扱っていた簡易 material 表示が失われる。Phase 5 で Rust 側 material 対応と合わせて回収する。

### 検証アセット

| アセット                                                                            | 経路                             | 結果                                            |
| ----------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| `samples/assets/usd/tiny.usda`                                                      | USDA（layer 1）                  | USDLoader 経路で描画（既存挙動維持）            |
| `samples/private/usd/Kitchen_set/.../Ball.geom.usd`                                 | USDC 単体                        | GLB 経路で描画                                  |
| `samples/private/usd/Kitchen_set/.../Ball.usd`                                      | USDA root + payload chain → USDC | GLB 経路で描画                                  |
| `samples/private/usd/Kitchen_set/.../Kitchen_set.usd`                               | USDA + 228 USDC refs             | GLB 経路、release ビルド 234ms で 37MB GLB 生成 |
| `chameleon_anim_mtl_variant.usdz` / `glove_baseball_mtl_variant.usdz` / seahorse 系 | USDZ（USDA root）                | USDLoader 経路で描画                            |

### 自動テスト

- **openusd fork 側** (`cargo test -p openusd`): `root_layer_is_binary` / `mesh_of` / `local_xform_of` の単体テスト
- **yw-look Rust 側** (`cargo test --lib usd::`): GLB builder 3 件 + backend integration 20 件（tiny.usda、Kitchen Set 4 種、Ball.usd、USDZ 3 種、pivot pair regression、negative face counts rejection 等）
- **yw-look frontend** (`npm run test`): 41 vitest

### 非スコープ（Phase 3）

- アニメーション（USD skeletal / blend shape → Three.js morph）
- USDZ 内テクスチャの Rust 側展開
- native instancing（upstream merge 待ち）
- variant set の切り替え UI
- `payload` の deferred load / unload 制御
- UsdPreviewSurface → GLB material 変換（Phase 5）
- 凹 n-gon の ear-clip triangulation（Phase 5）
- `USDLoader.parse` の Web Worker 退避（別フェーズ）

---

## Phase 4 — Payload 遅延ロード（実装済み）

### 目的

`references` は通常 compose したまま、`payloads` だけを遅延ロード対象にする。重い USD シーンでも hierarchy と基本情報は素早く見せ、必要になった payload だけ後から読み込める状態を目指す。

### 方針

- `references` は常に通常どおり読み込む
- `payloads` のみ load policy の対象にする
- 初期モードは 2 つに絞る
  - `loaded` — 現在どおり payload を含めて compose
  - `deferred` — payload を展開せず summary / hierarchy を先に出す
- `.usdz` でも拡張子ではなく **root layer が binary USD かどうか** で表示パイプラインを分岐する

### 想定 UX

```text
USD ファイル開封
  ├─ references は compose 済み
  ├─ payloads は deferred
  │    ├─ hierarchy には payload prim を表示
  │    ├─ inspector には loaded / unloaded / missing を表示
  │    └─ preview は payload なしの軽量結果を先に表示
  └─ ユーザー操作または明示コマンドで payload を load
       └─ 対象 prim の geometry を追加取得して viewer に反映
```

### API 進化の方向

最初は stateless に試し、必要になったら stateful session に進む。

#### 1. stateless（先に試す）

- `summarize_stage(path, load_policy)`
- `inspect_stage(path, load_policy)`
- `extract_geometry(path, load_policy, prim_paths?)`

#### 2. stateful session（必要なら）

- `open_stage(path, load_policy) -> stage_id`
- `load_payloads(stage_id, prim_paths?)`
- `unload_payloads(stage_id, prim_paths?)`
- `extract_geometry(stage_id, prim_paths?)`

payload の局所 load / unload を UI と同期したくなった時点で session 化する。

### 達成条件

1. `references` は従来どおり自動で compose される
2. `payloads deferred` モードで summary / hierarchy / issues が取得できる
3. payload prim が `loaded / unloaded / missing` のいずれかで識別できる
4. 指定 payload の load 後に viewer を再構築または差分更新できる
5. Kitchen Set クラスで「まず開ける」体験が改善したと確認できる

### 非スコープ（Phase 4）

- payload の自動優先度制御
- カメラ位置に応じた streaming
- variant set と payload load policy の同時最適化
- アニメーション対応
- ネットワーク越しの遠隔 asset streaming

### 実装サマリ（Phase 4a + 4b + 4c）

#### fork 側 (`yohawing/openusd`, branch `yw-look-phase4`)

| 追加 API                                   | 内容                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `StageLoadPolicy::{LoadAll, NoPayloads}`   | `#[non_exhaustive]` enum。`LoadAll` がデフォルトで Phase 3 挙動を維持     |
| `SkippedPayload { asset_path, prim_path }` | `NoPayloads` で飛ばした payload 1 件を表す。`prim_path` は**宣言元 prim** |
| `StageBuilder::load_policy`                | builder 経由で policy を仕込む。`Stage::open` シグネチャは非変更          |
| `Stage::skipped_payloads`                  | 合成結果に溶け込まなかった payload の一覧                                 |
| `Stage::load_policy`                       | 現在の policy を返すアクセサ                                              |

- 注入ポイント: layer collection の `collect_recursive` で `DependencyKind::Payload` を recurse 前に弾く
- 追加で pcp 側にも `skip_payloads: bool` を伝播（root layer の prim spec に残る authored payload listOp を pcp が評価しに行って `Error::UnresolvedLayer` を投げるため）
- `Stage::open` / `references_in` / `payloads_in` / `unresolved_assets` / `mesh_of` / `local_xform_of` のシグネチャは**一切変更なし**
- テスト: `fixtures/ball_payload/` に最小 USDA を追加して `load_all` / `no_payloads` / layer count / traverse 完走の 4 本

#### yw-look 側 (`src-tauri/src/usd/`)

- wire 型 `StageLoadPolicy { LoadAll, NoPayloads }` を `types.rs` に追加、`#[serde(rename_all = "camelCase")]` で `loadAll` / `noPayloads` に統一
- `CompositionArcState` を 3 値化（`Loaded` / `Missing` / `Unloaded`）
- `StageSummary.unloaded_payload_count`、`StageInspection.load_policy` を追加
- `UsdBackend` trait: `inspect_stage` / `summarize_stage` / `extract_geometry_glb` が `policy: StageLoadPolicy` を必須引数として受け取る。`collect_asset_issues` / `requires_glb_preview` は常に `LoadAll` で走る
- Tauri コマンドは `policy: Option<StageLoadPolicy>` を受け付け、`unwrap_or_default()` で後方互換を維持（Phase 3 frontend からの invoke も黙って LoadAll で通る）
- `payload_arc_state` の skip set は `(asset_path, source_prim)` 2 値キー。`Stage::skipped_payloads` は宣言元 prim を記録し、`payloads_in` の戻り値 `p.prim_path` は external layer 内の target prim なので、**source と target が異なる場合に取り違えないよう明示的に使い分ける**

#### Frontend

- `src/lib/usd.ts`: `StageLoadPolicy` / `CompositionArcState` 3 値 / `unloadedPayloadCount` / `loadPolicy` を型に追加、`summarizeStage` / `inspectStage` / `extractGeometry` が optional policy 引数を受け付け
- `UsdInspectorCard`: ヘッダに `Loaded` / `Deferred` segmented control を配置、`unloadedPayloadCount` を Payloads 行にインラインで併記
- `CompositionArcsCard`: `Deferred` バッジ（`.badge-muted` 中立色）を追加して `missing`（エラー色）と分離表示
- `App.tsx`: `usdLoadPolicy` state を導入し inspector エフェクトの依存配列に追加、`AssetViewport` 経由で `loadPreviewObject` にも伝搬
- `AssetViewport` / `loaders.ts`: 依存配列に `usdLoadPolicy` を追加し、切替時に古い GLB scene を dispose してから `extract_geometry(path, policy)` を再実行

#### デフォルト UX

- 初期値は `loadAll` を維持（Phase 3 挙動を壊さない）
- heuristic トースト（例: `payloadCount > 50` で Deferred 提案）は Phase 5 以降で検討
- stateful session (`open_stage` / `load_payloads`) は Phase 5 以降で再評価

#### 後続課題

- `[patch."https://github.com/yohawing/openusd.git"]` を `src-tauri/Cargo.toml` に一時追加中。`yw-look-phase4` ブランチが upstream に push されたら `rev` を `54cb0eb94d7171cb3b5f306b9faf742faf3e61f6` に更新して patch を削除する
- Kitchen Set クラスでの初回表示時間の実測（`performance.now()` で計測ポイントを追加）
- payload 単位 load / unload UI（現状は stage 全体 toggle のみ）

---

## Phase 5 — Preview 品質向上（計画）

### 目的

USD シーンを「開ける」だけでなく、「作者が意図した状態に近い見た目で素早く確認できる」ことを目指す。Phase 3/4 で表示基盤と payload 制御を整えた上で、preview として価値の高い USD 機能を順に追加する。

### 優先対象

#### 1. Variant Set

- variant set 一覧を inspector に表示する
- 選択中 variant を表示する
- 主要 variant の切り替えを UI から行えるようにする

見た目違い・LOD・素材違いが variant に載ることが多く、preview 価値が高い。

#### 2. Purpose

- `default` / `render` / `proxy` / `guide` の表示ポリシーを持つ
- 重いシーンでは `proxy` を優先して開けるようにする

USD の「軽く見せる」設計に素直に乗れる。

#### 3. PointInstancer

- scatter / vegetation / crowd 系で使われる `PointInstancer` を表示する
- 同一 prototype mesh を GPU インスタンス化して負荷を抑える

対応有無で scene の再現度が大きく変わる。

#### 4. GeomSubset / Material Binding

- mesh 単位だけでなく face subset 単位の material binding を反映する
- `UsdPreviewSurface` の割り当て精度を上げる

単一 mesh に複数 material が載るケースの見た目に効く。

#### 5. Camera / Framing

- stage 内 camera を列挙して切り替えられるようにする
- authored camera がない場合でも extent / bounds から framing を安定化する

レビュー時に「最初に何が見えるか」の品質を上げられる。

### 達成条件

1. 代表的な USD アセットで variant の切り替え結果を preview に反映できる
2. purpose の違いで render / proxy 表示を切り替えられる
3. PointInstancer を含むシーンが大崩れせず表示できる
4. GeomSubset material が最低限正しく見える
5. authored camera または安定した auto-framing で初期視点が改善する

### 非スコープ（Phase 5）

- skeletal animation / blend shape の完全対応
- Hydra 相当の完全な見た目再現
- layer 編集
- composition 編集 UI

### Phase 5b — Skel API WIP（fork のみ、yw-look 統合は繰越）

ストレッチ目標として fork (`yohawing/openusd`, branch `yw-look-phase4`) に最小 SkelAPI を導入したが、**yw-look 側 GLB パイプラインへの統合は次セッション以降に繰越**。理由は下記。

#### fork 側で実装済み (commit `5c44588`)

- `pub struct SkeletonData { joints, bind_transforms, rest_transforms, parents }`
- `pub struct SkelAnimationData { times, translations, rotations, scales, joints }` (型のみ、body は deferred stub)
- `Stage::skeleton_of(mesh_path) -> Option<(Path, SkeletonData)>` — `SkelBindingAPI::skel:binding` + ancestor `SkelRoot` walk の 2 経路
- `Stage::skel_animation_of(skeleton_path) -> Option<SkelAnimationData>` — 現状常に `None`、rustdoc に deferral 理由を記載
- `fixtures/skel_smoke/` に 2-joint Hip/Spine fixture と 5 本のテスト

#### 繰越理由

1. **animation の time-sampled 配列読み取りが USDA parser でブロック中**
   - `openusd::pcp` の `resolve_field` は `FieldKey::TimeSamples` を `Value::TimeSamples(TimeSampleMap)` として返せる設計
   - USDC reader (`src/usdc/reader.rs`) は `Type::TimeSamples` を正しくデコード
   - しかし USDA parser の `parse_time_samples` (`src/usda/parser.rs:1096-1110`) は各サンプル値を `parse_property_metadata_value()` で読むため、`float3[] translations.timeSamples = { 0: [(0,0,0), (0,1,0)] }` のような **配列型 vector のサンプル** を食わせると `"Unsupported property metadata value token: Punctuation('(')"` で落ちる
   - スカラー time sample（`fixtures/timesamples.usda` の `double prop.timeSamples = { 4: 40 }`）は通るが、SkelAnimation の translations/rotations/scales はすべて配列型 vec で必ずこのパスを通るため、USDA 単独で end-to-end 検証する fixture が作れない

2. **per-vertex skinning data (`primvars:skel:jointIndices` / `primvars:skel:jointWeights`) が `MeshData` に載っていない**
   - 現状の `Stage::mesh_of` は points / faceVertexCounts / faceVertexIndices / normals / uvs のみ
   - skin を glTF に書き出すには各頂点に joint index 4 つ + weight 4 つが必要
   - `MeshData` 拡張（あるいは別型 `SkinData` の追加）は Phase 5c の課題

3. **yw-look 側では bind pose のみ embed しても見た目が変わらない**
   - skeleton を glTF skin として埋め込んでも、animation channels と per-vertex skinning がなければ rest pose と同じ見た目になる
   - 部分的な統合よりも、上記 2 点が解決した時点で一括統合するほうが回帰検知しやすい

#### Phase 5c で必要な作業

1. USDA parser の `parse_property_metadata_value` を配列型 vector を受理するよう拡張（`src/usda/parser.rs:1096`）、または USDC で SkelAnimation fixture を用意
2. `Stage::skel_animation_of` の body を実装（API shape は確定済み、`skel:animationSource` rel を辿って `translations` / `rotations` / `scales` を `FieldKey::TimeSamples` 経由で読むだけ）
3. `MeshData` または新しい `SkinData` 型に `joint_indices: Vec<u32>` + `joint_weights: Vec<f32>` を追加
4. yw-look 側 `glb.rs` に `SkinInput` を導入、glTF nodes / skin / inverseBindMatrices を出力
5. `loaders.ts` 側は既存の glTF skin 経路（FBX/glTF と同じ `THREE.AnimationMixer` 連携）にそのまま乗る

---

## Phase 5c — Texture & Skinning パイプライン（実装済）

### スコープ

Phase 5a で「scalar PBR factor のみ」、Phase 5b で「skeleton の bind pose のみ」と意図的に削った 2 つの軸を一気に閉じる。

| ID  | 項目                                                                                                                                                 | 担当    | 状態                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| A   | USDZ 内 texture を GLB BIN chunk に埋め込み (`UsdPreviewSurface.diffuseColor` の texture path を image / texture / sampler としてエクスポート)       | yw-look | ✅ 実装済 (filesystem fixture e2e + Codex P1+P2 fix)    |
| B   | USDA parser の `parse_property_metadata_value` を配列型 vector 値で受理可能にする                                                                    | fork    | ✅ 実装済 (`52029e6`)                                   |
| C   | `MeshData` に `joint_indices` + `joint_weights` を追加し、`Stage::mesh_of` で `primvars:skel:jointIndices` / `primvars:skel:jointWeights` を読み込む | fork    | ✅ 実装済 (`6b51a5f` + `b36f6b4` の elementSize 型 fix) |
| D   | `Stage::skel_animation_of` の body を `FieldKey::TimeSamples` 経由で実装                                                                             | fork    | ✅ 実装済 (`dcdd16e`)                                   |
| E   | yw-look 側 `glb.rs` に `SkinInput` / `AnimationInput` を追加して glTF nodes / skin / inverseBindMatrices / animation channels を出力                 | yw-look | ✅ 実装済 (skinned mesh e2e + Codex P1×4 + P2 fix)      |

### Phase 5c E の Codex フィードバック (適用済)

- **P1 [fork rest matrices column-major]**: `SkeletonData::bind/rest_transforms` は fork で既に column-major なので yw-look 側で transpose しない (元コードは二重 transpose していた)
- **P1 [skinned mesh world transform]**: skinned mesh node は identity ではなく `mesh.world_matrix` を載せる。vertex 位置は mesh-local のままで、glTF skin の inverseBindMatrices と組み合わせて world に展開される
- **P1 [animated joint TRS]**: glTF は node `matrix` のアニメーションを許さないので、joint nodes は rest local matrix を **TRS に decompose** して `translation` / `rotation` / `scale` で出力する
- **P1 [time codes → seconds]**: `Stage::skel_animation_of` の time samples は **USD time code** なので glTF sampler input に書く前に `stage.field<f64>(abs_root, FieldKey::TimeCodesPerSecond).unwrap_or(24.0)` で割って秒に変換する
- **P2 [sparse channel handling]**: rotation / scale が translation のタイムラインに対して sparse な場合、欠損フレームは `[0,0,0,0]` クォータニオンや `[0,0,0]` スケールで埋めずに **その joint のチャネルごと drop** して runtime に rest pose を継承させる

### Phase 5d 進捗

#### F1 — variant set / Windows path resolution (完了, fork `930bfc5`)

最大の unblock 候補だった variant set 解決は、調査の結果 **fork pcp が元から実装済み** であることが判明（`resolve_variant_selections_in` / `eval_variants` が strongest-first で selection を解決し、authored 無しでは各 variant set の最初の variant を採用）。Phase 5d F1 では:

1. 既存挙動を pin する 3 本の smoke test と 3 つの fixture を `fixtures/variant_select/` に追加（明示選択 / 暗黙 first-variant / 空 variant の regression guard）
2. 別の Windows 固有 blocker を発見・修正: `src/pcp/index.rs::find_layer` が `std::path::MAIN_SEPARATOR` (Windows では `\`) を境界判定に使っていたため、POSIX style needle (`./assets/foo.usd`) と DefaultResolver が返す `\\?\C:\...\assets\foo.usd` 形式の identifier の suffix match が失敗し、`HumanFemale.walk.usd` のような cross-OS reference を持つ asset が `unresolved Reference layer` で死んでいた。両辺を `/` 正規化してから比較するように修正、`find_layer_posix_needle_windows_identifier` で regression guard

これにより chameleon の `bound_material` は 6 つの distinct material path (`chameleon_mat_1` / `chameleon_mat_1_2` / ... / `stick_placeholder_mat_1`) を正しく返すようになり、yw-look の mesh traverse も 6 件すべて拾えている。

#### L2 — chameleon shader property composition gap (調査済み, 修正は Phase 5e へ re-scope)

Phase 5d L2 は当初 「fork の `material_of` を NodeGraph wrap 越しに歩かせる」 タスクとして起票したが、fork agent の dump 調査 (`fork 0d40283`) で **NodeGraph wrap 仮説は崩れた**:

```
/Root/chameleon_idle/Looks/
  chameleon_mat (Material, has_spec=true, properties=0)
    UsdPreviewSurface (Shader, has_spec=true, properties=0)  ← 直下にいる
  chameleon_mat_1 .. chameleon_mat_1_2_3_4_5_6_7_8_9_10
    UsdPreviewSurface (Shader, 同上)
  stick_placeholder_mat
    UsdPreviewSurface (Shader, properties=1, diffuseColor=Vec3f([0.11, 0.055, 0.057]))
```

chameleon の `UsdPreviewSurface` Shader は **Material 直下にあって NodeGraph wrap されていない**。`material_of` walker を再帰化しても解決しない。真因はもっと上流の **property spec が composition で消えていること**:

| Material                  | shader has_spec | inputs:diffuseColor Default   | inputs:diffuseColor has_spec |
| ------------------------- | --------------- | ----------------------------- | ---------------------------- |
| `chameleon_mat`           | true            | None                          | **false**                    |
| `chameleon_mat_1`         | true            | None                          | **false**                    |
| `chameleon_mat_1_2_3_4_5` | true            | None                          | **false**                    |
| `stick_placeholder_mat`   | true            | `Vec3f([0.11, 0.055, 0.057])` | true                         |

加えて variant 解決後に `chameleon_mat_1_2_3_4_5_6_7_8_9_10` のような **suffix 付き Material が 11 個生成** されているのが見える。これは variant compose 時に同じ Material spec が複数回 propagate されて auto-rename されている (variant 解決時の prim duplicate バグ) 可能性が高い。Phase 5d F1 で variant 解決を pin した時には観測できていなかった、F1 で生まれた regression かもしれない。

##### 真因候補と次の調査方向 (Phase 5e+)

1. **USDC decode の漏れ**: chameleon は USDC binary 内で Shader input properties を authoring。`src/usdc/reader.rs` が特定の field / valueRep を skip している可能性
2. **variant compose 時の property arc 引き継ぎミス**: prim tree の rename / duplicate で property child arc が新しい prim に伝搬されていない
3. **spec type filter**: reader が PropertySpec を Material/Shader の下で読まずに捨てている

調査の最初の一手:

- `chameleon_mat` (suffix なし、F1 variant 解決前から存在) の properties が 0 なら → **USDC decode 段階の問題**、`src/usdc/reader.rs` 側を疑う
- Layer-level raw spec dump で composition resolve 前の生 layer に `inputs:diffuseColor` が authored されているか確認 (`Layer` API)

`fork 0d40283` には diagnostic dump test (`#[ignore]`) が残してあるので次のセッションで pickup できる。

##### Phase 5d L2 の re-scope

実装すべきは「NodeGraph walker」ではなく **「chameleon shader property composition gap 調査 + 修正」**。範囲が深いので Phase 5e の独立タスクとして切り出す。yw-look 側の `extract_geometry_chameleon_textured_smoke` は当面 `materials.len() >= 2` + `mesh_count >= 5` の構造 baseline で `#[ignore]` のまま据え置き。

#### F3 — composition cycle の過検知 (HumanFemale 系、未着手)

F1 で Windows path 問題が解けた後、`HumanFemale.walk.usd` の layer stack 12 層は collect に成功するが、次の段階で `composition arc cycle at /HumanFemale_Group/HumanFemale (depth 2)` で死ぬ。pcp 側 cycle 判定の過検知（`HumanFemale.full.usd` → `HumanFemale.full_payload.usd` → 複数 instance への rematch）と推測。Phase 5d F3 で pcp の cycle 判定を見直す必要があるが、pcp graph 内部に踏み込むため範囲が大きい。Phase 5e に持ち越す可能性あり。

### 並行戦略

- **Track 1 (即着手)**: メインエージェントが **A (texture embedding)** を yw-look 側で実装。fork ブロックがないので Phase 5c 全体の進捗を稼ぐ
- **Track 2 (即着手)**: fork agent 1 が **B (USDA parser fix)** を実装。`stage.rs` を触らないので C と排他しないよう `usda/parser.rs` のみに集中する briefing
- **Track 3 (B + 追加 fork agent)**: fork agent 2 が B 完了後に **C (MeshData skin) + D (skel_animation_of body)** を実装。両方 `stage.rs` を触るので 1 エージェントで逐次のほうが安全
- **Track 4 (C + D 後)**: メインエージェントが **E (yw-look glb skin/animation)** を実装

各節目で `cargo test --lib usd::` + `npm run typecheck` + `npm test` + Codex review + commit。

### A の実装ノート (yw-look 側、即着手)

- `MaterialData.diffuse_texture` に asset 文字列が入っている場合のみ走る経路
- Asset path 解決:
  - 絶対パス → ファイルを直接読む
  - 相対パス → USDA の場合は USDA ファイルからの相対、USDZ の場合は zip エントリ
- USDZ archive の中身を取り出すには、`zip` クレートを fork ではなく yw-look 側に追加するか、stage 経由で読める道があるか確認
  - 既存 yw-look の `viewer/loaders.ts` にすでに USDZ を扱う経路があるかチェック
- GLB BIN chunk に PNG/JPEG バイトを入れ、glTF `images` / `textures` / `samplers` を追加
- `MaterialInput` に `base_color_texture: Option<usize>` (texture index) を追加
- mesh primitive の `pbrMetallicRoughness.baseColorTexture` を出力
- TEXCOORD_0 はすでに出力済み

### B の実装ノート (fork 側)

- 失敗箇所: `src/usda/parser.rs:1096-1110` 付近の `parse_property_metadata_value`
- 現在のエラー: `"Unsupported property metadata value token: Punctuation('(')"`
- USDA の time sample で配列型 vector 値が来た時の syntax 例:
  ```
  float3[] translations.timeSamples = {
      0: [(0, 0, 0), (0, 1, 0)],
      24: [(0, 0, 0), (0, 1, 0.5)],
  }
  ```
- `parse_array_value` 系の既存ヘルパが流用できないか調査。tuple `(x, y, z)` のパースも合わせて必要
- 既存 timesamples テスト (`fixtures/timesamples.usda` のスカラー path) を壊さないこと

### C の実装ノート (fork 側)

- `MeshData` 拡張: `joint_indices: Vec<u32>`, `joint_weights: Vec<f32>` を追加（option ではなく空 Vec を許容するか、`Option<Vec<...>>` か）
- 読み出し: `primvars:skel:jointIndices` (int[]) / `primvars:skel:jointWeights` (float[])
- USD では interpolation `vertex` か `faceVarying` を見る必要がある（既存 normals / uvs と同じ流れ）
- joints per vertex の数 (`elementSize` metadata) も読む — glTF は per vertex 4 を期待するので、4 でないなら最初の 4 だけ採用 or 重み再正規化

### D の実装ノート (fork 側)

- `skel:animationSource` relationship を辿って `UsdSkelSkelAnimation` prim を取得（既存 `bound_material` と同パターン）
- `joints` (uniform token[]) を読む
- `translations` / `rotations` / `scales` を `FieldKey::TimeSamples` 経由で取得
- `Value::TimeSamples(TimeSampleMap)` を `Vec<(f64, Vec<f32>)>` 形式に整形
- B が完了して USDA fixture が書ければ end-to-end テストも追加可能

### 検証

- A: USDZ サンプル (chameleon / glove / seahorse) で texture が出力 GLB に含まれることを cargo test で検証 + preview-model でスクショ確認
- B: USDA SkelAnimation fixture を `fixtures/skel_animation/` に追加して parse できる単体テスト
- C: jointIndices / jointWeights 付き fixture で `mesh_of` が値を返すテスト
- D: `skel_animation_of` で 2 フレームの translations を読み取れるテスト
- E: 統合 USDA で skin 付き mesh を extract → preview-model で T ポーズ + animation 確認

---

## 通しの方針・制約

- **表示は Three.js / 検査は Rust** を基本方針とする
- Rust 側は `UsdBackend` trait で実装を隠蔽し、parser 差し替えに備える
- fork (`yohawing/openusd`) の変更は可能な限り upstream PR として提案する
- Windows MSVC での pure Rust ビルドを維持する（C++ FFI は持ち込まない）
