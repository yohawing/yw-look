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

## Phase 4 — Payload 遅延ロード（実装済）

`references` は常時 compose、`payloads` のみ deferred 対象。stateless API（各 Tauri コマンドに `policy: Option<StageLoadPolicy>` 引数を追加）で実装。

### fork 側 API

| API                                      | 内容                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `StageLoadPolicy::{LoadAll, NoPayloads}` | builder 経由で policy を仕込む。`Stage::open` 非変更 |
| `Stage::skipped_payloads()`              | NoPayloads でスキップした payload の一覧             |

### yw-look 側

- `CompositionArcState` を 3 値化 (`Loaded` / `Missing` / `Unloaded`)
- UsdInspectorCard にヘッダ segmented control (`Loaded` / `Deferred`)
- `usdLoadPolicy` state 切替で inspector + GLB viewer を再走

---

## Phase 5 — Preview 品質向上（実装済）

### 完了項目

| 機能                       | 概要                                                                                                                                       | 検証結果                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Ear-clip triangulation** | 凹 n-gon の ear-clipping。凸ポリゴンは従来の fan fast path を維持                                                                          | Kitchen Set 回帰 green                               |
| **PBR material (scalar)**  | `UsdPreviewSurface` の diffuseColor / metallic / roughness / opacity / emissive を GLB material に反映。sRGB→linear 変換 + alphaMode BLEND | 自作 fixture で e2e green                            |
| **PBR material (texture)** | USDZ archive / filesystem の PNG/JPEG を GLB BIN chunk に埋め込み、baseColorTexture として出力。per-material sampler dedup                 | **Glove: テクスチャ付き描画 ✅**                     |
| **displayColor fallback**  | `primvars:displayColor` (constant) を `baseColorFactor` にマッピング。`material:binding` がない mesh 用                                    | **Kitchen Set: カラフル描画 ✅**                     |
| **wrapS/wrapT sampler**    | UsdUVTexture の wrap mode token → glTF sampler 定数 mapping                                                                                | fork `d4e9cd2`                                       |
| **MaterialX 互換**         | `ND_UsdPreviewSurface_surfaceshader` / `ND_image_color3` 等の MaterialX node ID を受理                                                     | **Glove: material_of 解決 ✅**                       |
| **UsdSkel skin**           | `skeleton_of` → SkeletonData、`mesh_of` skin primvars、GLB skin + JOINTS_0 / WEIGHTS_0 出力、TRS decompose                                 | **HumanFemale: 87 mesh 描画 ✅**                     |
| **SkelAnimation**          | `skel_animation_of` → SkelAnimationData、GLB animation channels、USD time code → seconds 変換                                              | tiny_rigged.usda で Three.js AnimationMixer 動作確認 |
| **Variant set**            | fork pcp が元から実装済みと確認。smoke test 3 本を pin                                                                                     | fixture 3 本 green                                   |
| **Windows path fix**       | `find_layer` の path separator 正規化。HumanFemale が layer collect 成功するように                                                         | `930bfc5`                                            |
| **pcp false cycle fix**    | ancestor propagation の eval_stack guard。HumanFemale が compose 完了するように                                                            | `b895c9b`                                            |

### 既知の制約

| 項目                        | 状態                | 理由                                                                                                               |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **chameleon テクスチャ**    | 非対応 (asset-side) | UsdPreviewSurface stub のみ、本物の shading は別 prim tree の MaterialX subgraph。composition arc で繋がっていない |
| **per-vertex displayColor** | 未実装              | constant (1 色/mesh) のみ対応。per-vertex → GLB `COLOR_0` は今後の課題                                             |
| **multi-hop shader graph**  | 未実装              | 1-hop texture connection のみ。NodeGraph wrapping は別 asset で需要が出たら対応                                    |
| **GeomSubset material**     | 未実装              | face subset 単位の material binding。Kitchen Set では不使用                                                        |
| **PointInstancer**          | 未実装              | scatter/vegetation/crowd 用                                                                                        |
| **Purpose**                 | 未実装              | `default` / `render` / `proxy` / `guide` の表示切替                                                                |
| **Stage Camera**            | 未実装              | authored camera の列挙と切替                                                                                       |
| **per-prim payload load**   | 未実装              | stateful session (`open_stage` / `load_payloads`) は延期                                                           |

---

## Phase 5.5 — C++ バックエンド PoC（実装済 / 家で検証待ち）

docs/usd-cpp-poc.md と docs/usd-cpp.md に詳細。要約:

- vcpkg manifest で Pixar OpenUSD を依存宣言し、手書き C shim (`third_party/usd_c_shim/`) 経由で bindgen
- Cargo feature `backend-openusd-cpp` で `OpenusdBackend` (Rust fork) と `OpenusdCppBackend` を切替
- PoC スコープは **Inspector API のみ** (`inspect_stage` / `summarize_stage` / `collect_asset_issues` / `root_layer_is_binary`)
- geometry / material / skel は Phase 9 で追加（後述、優先度低）
- 対応: Windows x64 / macOS arm64

**Hydra は採用しない**。Pixar Hydra 経由なら material network / light / instancer がまとめて解決できるが、バイナリ +60〜100 MB / 初回ビルド +30 分 のコストに対して yw-look のサイズ感とメリットが釣り合わないため不採用。代わりに Phase 6-8 の feature は C++ 側でも Rust fork 側でも素朴に USD schema を walk して実装する。

---

## Phase 6 — マテリアル詳細（計画中・週末アタック）

### 目的

Phase 5 の「既知の制約」のうち、**マテリアル系で実アセットに影響の大きい 4 項目**を Rust fork に実装する。C++ backend への port は Phase 9 で後追い、fork の変更は upstream PR 候補。

### スコープ

| サブフェーズ | 機能                                   | 想定工数 | 想定コミット                                      |
| ------------ | -------------------------------------- | -------- | ------------------------------------------------- |
| **6a**       | Normal map (`inputs:normal` 1-hop)     | 4〜6 h   | `loader: resolve UsdPreviewSurface normal input`  |
| **6b**       | UsdTransform2d (texture tile / offset) | 4〜6 h   | `loader: apply UsdTransform2d to UV coordinates`  |
| **6c**       | PrimvarReader + per-vertex displayColor | 6〜8 h   | `loader: surface vertex colors via PrimvarReader` |
| **6d**       | UsdSkelBlendShape → GLB morph targets  | 12〜16 h | `loader: emit morph targets for UsdSkelBlendShape` |

合計: 26〜36 h。週末（16〜20 h）で 6a-6c、6d は持ち越し可。

### 各サブフェーズの詳細

#### 6a. Normal map

fork 側 `Stage::material_of` の `MaterialData` に `normal_texture: Option<TextureBinding>` を追加。yw-look 側で glTF `materials[n].normalTexture` として出力、USDZ archive or filesystem 解決は既存 `TextureLoader` を再利用。

- 検証アセット: glove_baseball (既に normal map 付き) / 自作 fixture
- GLB viewer で法線の出方が DCC 側表示と一致すること
- scale パラメータ (`inputs:scale` on UsdUVTexture chained to normal) は Phase 10 に延期

#### 6b. UsdTransform2d

UsdShade の `UsdTransform2d` ノードを検出し、`inputs:scale` / `rotation` / `translation` を読んで glTF の `KHR_texture_transform` extension に変換。

- 検証: tile 繰り返しをしている自作 fixture
- Three.js 側は `KHR_texture_transform` を標準サポート
- GeomSubset と混ざるケースは Phase 10 に延期

#### 6c. PrimvarReader + per-vertex displayColor

- `UsdPrimvarReader_float3` が `primvars:displayColor` を参照していれば、mesh の per-vertex color を GLB `COLOR_0` 属性として出力
- `UsdPrimvarReader_float2` の custom UV (`primvars:st2` など) は attr 2nd UV として `TEXCOORD_1` に
- `AttrKind::Vertex | FaceVarying` のみ対象（`Constant` は既存 displayColor fallback で処理済み）

#### 6d. BlendShape（持ち越し可）

- fork に `Stage::blend_shapes_of(mesh_path) -> Vec<BlendShapeData>` 追加
- `BlendShapeData` は offset positions + point indices を持つ
- GLB の `primitives[n].targets` + `meshes[n].weights` として出力
- USD の time sample → glTF animation channel (`weights`)
- 検証アセット: 自作 morph fixture

### 横断

- 各サブフェーズは **独立コミット** で進める（AGENTS.md のコミット運用に従う）
- fork 側 API 追加 → yw-look 側でそれを読む → GLB 出力 → 検証 → コミット の順
- 週末終了時点で最低でも 6a / 6b が release ブランチに入ることを target

---

## Phase 7 — シーン完成度（計画）

### 目的

アセット単体の描画だけでなく、USD が記述している**シーン状態（ライト・カメラ・可視性切替）**を viewer に反映する。

| サブフェーズ | 機能                                        | 概要                                                                               |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| **7a**       | UsdLuxLight → Three.js lights               | DomeLight / DistantLight / RectLight / SphereLight / DiskLight / CylinderLight の 6 種 |
| **7b**       | UsdGeomCamera 列挙 + 切替 UI                | authored camera のドロップダウンで視点切替、viewer 標準カメラにも戻れる           |
| **7c**       | Purpose 切替 UI                             | `default` / `render` / `proxy` / `guide` の on/off トグル                         |

### 7a の補足

DomeLight は Three.js の `PMREMGenerator` + env map として扱う。`inputs:texture:file` の HDR / EXR を読み取り、既存 `HDRJPGLoader` 系の流用を検討。

他のライトは intensity / color / exposure を Three.js light の `intensity` へ変換。`enableColorTemperature` + `colorTemperature` は Planck の式で sRGB 色に変換してから乗算。

### 7b の補足

`inputs:focalLength` / `focusDistance` / `fStop` / `clippingRange` を Three.js `PerspectiveCamera` に写す。aperture は今は無視（DoF 未対応）。

### 7c の補足

現状は `proxy` / `guide` を無条件でフィルタしているが、DCC 系のチェック用途では `proxy` を見たい場面もある。UI トグルで viewer 側の可視状態を動的に切り替える。GLB は purpose ごとに別 GLB を生成する方針（4 × GLB）か、単一 GLB で node visibility flag を切り替える方針（1 × GLB、Three.js 側 object.visible）のどちらかを採用。後者の方が軽いので推奨。

---

## Phase 8 — 非 Mesh prim type（計画）

### 目的

Mesh 以外のジオメトリ表現に対応。**現状は全て空描画**になる。

| サブフェーズ | 機能                                        | 概要                                                   |
| ------------ | ------------------------------------------- | ------------------------------------------------------ |
| **8a**       | PointInstancer                              | scatter された mesh を GLB `EXT_mesh_gpu_instancing` で出力 |
| **8b**       | UsdGeomPoints                               | 点群 → Three.js `Points` or glTF `POINTS` primitive    |
| **8c**       | UsdGeomBasisCurves                          | カーブ・髪・リボン → Three.js `Line2` 系               |
| **8d**       | Geometry primitives                         | Sphere / Cube / Cylinder / Cone / Capsule → Three.js 標準 geometry |

### 8a の補足

`UsdGeomPointInstancer` の `positions` / `orientations` / `scales` / `protoIndices` を読んで、protoIndex ごとに別 GLB mesh を用意、各インスタンスは `EXT_mesh_gpu_instancing` の `TRANSLATION / ROTATION / SCALE` attribute で展開。これで Kitchen_set_instanced が Rust fork でも描画できるようになる（fork 側の instanceable フラグ解釈とは別解決）。

### 8b-c の補足

点群・カーブは glTF 標準サポートが弱いため、**Three.js への直接受け渡し** or **viewer 側独自パイプライン**を検討。Rust fork 側では `points_of` / `curves_of` API を追加。

### 8d の補足

プリミティブ形状は parameter (radius / extent / height) だけ読み取れば三角分割できる。yw-look 側で Three.js `SphereGeometry` 等に変換、または Rust 側で triangulated mesh として GLB に詰める。前者の方が軽量。

---

## Phase 9 — C++ バックエンド geometry 拡張（計画、優先度低）

### 目的

C++ backend (Phase 5.5) を inspector-only から **geometry / material / skel まで対応**させ、Rust fork の代替として使える状態にする。

### 前提条件

- Phase 5.5 の家での実ビルド検証が完了していること
- Exit rule（150 MB / クラッシュ率 / MSI ビルド時間）をクリアしていること

### 方針の転換

以前の計画では「C++ 側 API は Rust fork と 1:1 パラレル」としていたが、以下に緩める:

- **C++ 側が先行してよい**: Phase 6-8 で fork に追加した機能は、C++ shim では優先度と工数に応じて順次実装
- **Rust fork は後追い**: fork 側は独立に機能を拡充（PR merge / 自前コミット）。C++ backend に追いついた時点で parity
- **trait は共通**: `UsdBackend` trait のメソッドは両 backend が実装。fork で未実装の機能は `None` / `unimplemented!` を返し、frontend 側でフォールバック表示

### 優先順

1. `mesh_of` / `material_of` / `skeleton_of` / `skel_animation_of` の port（Rust fork と同じ MeshData / MaterialData 等を返す）
2. Phase 6 で追加したマテリアル系機能の port
3. Phase 7 で追加したライト / カメラ / purpose の port
4. Phase 8 で追加した prim type の port

### A/B 検証

Kitchen Set / HumanFemale / Kitchen_set_instanced / USDZ 3 種で両 backend を並行実行し、GLB 出力が意味的に一致する（prim 数、material 数、mesh 数、skin 数）ことを確認。差異があれば issue を切る。

---

## Phase 10 — 高度シェーディング / ニッチ形式（計画）

### 目的

残りの長期課題。Phase 9 以降に着手を検討。

| サブフェーズ | 機能                                   | 概要                                                           |
| ------------ | -------------------------------------- | -------------------------------------------------------------- |
| **10a**      | Multi-hop shader graph                 | UsdShadeNodeGraph の wrapping、任意 hop の texture / primvar 解決 |
| **10b**      | MaterialX ノード拡充                    | `ND_convert_*` / `ND_multiply_*` / `ND_mix_*` 等の標準ノード |
| **10c**      | USDZ 内 EXR / DDS / TGA テクスチャ      | 既存 `TextureLoader` の対応フォーマット拡張                     |
| **10d**      | UsdVol (volumetric)                    | OpenVDB 連携。Three.js 側の volume rendering 実装込み          |

---

## 横断テーマ（各 Phase に散らす）

- **Variant set インタラクティブ切替 UI**: 現状 read-only。session layer 経由で variant selection を上書きし、GLB を再生成する
- **Per-prim payload load**: stateful session API (`open_stage` / `load_payloads` / `unload_payloads`)。UI で payload ツリーを表示し個別に load/unload
- **Performance**: Kitchen Set (2048 prims / 234ms) は OK。次の負荷帯 (10k prims / 100k poly) で測る
- **回帰テスト資産**: 新しい機能を追加するたびに samples/manifest.json にテスト資産を追加する

---

## 通しの方針・制約

- **表示は Three.js / 検査は Rust** を基本方針とする
- Rust 側は `UsdBackend` trait で実装を隠蔽し、複数 parser 実装を並立できる構造を維持
- **C++ FFI を持ち込む方針に転換**: Phase 5.5 で Pixar OpenUSD C++ の薄い shim を導入（vcpkg 経由）。default feature は引き続き Rust fork、C++ backend は `backend-openusd-cpp` feature で opt-in
- fork (`yohawing/openusd`) の変更は可能な限り upstream PR として提案する
- **Hydra は採用しない**: バイナリサイズ・ビルド時間のコストに対して yw-look の要件（quick look スケール）と釣り合わない。material network 解決は手動で 1 hop ずつ行う方針を継続
- Rust fork と C++ backend は trait を共通にするが、**機能の実装順序は独立してよい**。先行した方で trait メソッドを定義し、後追いは `unimplemented!` か `None` でフォールバック
- 配布物 (MSI / .app) に C++ 依存を同梱する場合はライセンス表記を維持（docs/usd-cpp.md 参照）
