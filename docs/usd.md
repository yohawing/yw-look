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

- **`material_of()` (UsdPreviewSurface PBR)** — fork に `UsdShade` 実装が皆無で、Phase 3 のためだけに shader graph resolver を追加するのは重すぎる。GLB は default PBR material 1 個で出力し、Phase 5 で正式対応する
- **凹 n-gon の ear-clip triangulation** — 現状は fan 分割のみ。凹ポリゴンは破綻する可能性があるため Phase 5 で ear-clip を入れる

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

## Phase 4 — Payload 遅延ロード（計画）

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

---

## 通しの方針・制約

- **表示は Three.js / 検査は Rust** を基本方針とする
- Rust 側は `UsdBackend` trait で実装を隠蔽し、parser 差し替えに備える
- fork (`yohawing/openusd`) の変更は可能な限り upstream PR として提案する
- Windows MSVC での pure Rust ビルドを維持する（C++ FFI は持ち込まない）
