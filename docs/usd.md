# USD 対応 設計・記録ドキュメント

`yw-look` の USD サポートを記録する。方針決定・実装記録・残タスクをこのファイルに
集約する。

---

## 現状サマリ (2026-04-19 時点)

### バックエンド構成

| feature               | 位置づけ                         | 実装場所                            |
| --------------------- | -------------------------------- | ----------------------------------- |
| `backend-openusd-cpp` | **default** (Phase 2.J 以降)     | Pixar OpenUSD via vcpkg + C shim    |
| `backend-openusd-rs`  | opt-in（parity 検証 / Linux 用） | `yohawing/openusd` fork (pure Rust) |

- `cargo build` 素で cpp backend。Rust fork は `--no-default-features --features backend-openusd-rs` で opt-in。
- Linux は `compile_error!` で cpp を切り捨て済。Rust fork へ退避する必要あり。
- C++ backend の設計・手順: [`docs/usd-cpp.md`](./usd-cpp.md)
- C++ backend の PoC 当時の計画: [`docs/usd-cpp-poc.md`](./usd-cpp-poc.md)

### 機能カバレッジ（2026-04 時点、cpp backend）

| 機能領域                                   | 状態 | 備考                             |
| ------------------------------------------ | ---- | -------------------------------- |
| Inspector (stage metadata, prims, layers)  | ✅   | Phase 1                          |
| Geometry (mesh / xform / visibility)       | ✅   | Phase 2.C                        |
| faceVarying UV index expansion             | ✅   | Phase 2.C                        |
| UsdPreviewSurface scalar inputs            | ✅   | Phase 2.E.1                      |
| MaterialX UsdPreviewSurface flavors        | ✅   | Beyond-rs: ND\_\* variants       |
| Texture resolve (USDZ + filesystem)        | ✅   | Phase 2.F                        |
| Normal maps + ND_normalmap wrapper         | ✅   | Beyond-rs (cpp のみ)             |
| wrapS / wrapT → glTF sampler               | ✅   | Beyond-rs                        |
| UsdTransform2d → KHR_texture_transform     | ✅   | Beyond-rs (base+normal)          |
| GeomSubset per-face material split         | ✅   | Phase 2.I.2                      |
| displayColor fallback + per-vertex COLOR_0 | ✅   | Phase 2.I.1                      |
| UsdLux DistantLight / SphereLight          | ✅   | Phase 2.H                        |
| UsdGeomCamera perspective                  | ✅   | Phase 2.H                        |
| UsdSkel Skeleton + per-vertex skinning     | ✅   | Phase 2.G.1/2                    |
| UsdSkel rigid-follow (skel:joints only)    | ✅   | Beyond-rs: ARKit eye/tongue 対応 |
| UsdSkelAnimation (time-sampled TRS)        | ✅   | Phase 2.G.3                      |
| UsdSkel blend shapes (rest pose morph)     | ✅   | Phase 2.G.4                      |
| alphaMode / alphaCutoff                    | ✅   | Beyond-rs: Phase 2.M             |
| metallic / roughness ORM texture           | ✅   | Beyond-rs: Phase 2.N             |
| blendShapeWeights time-sampled animation   | ✅   | Beyond-rs: Phase 2.O             |

### 既知の未実装（残タスク候補、優先度順）

**material / shading**

- [ ] `UsdUVTexture.inputs:sourceColorSpace` の尊重（sRGB vs raw）
  - 現状 base color は sRGB 前提で linearize。normal / roughness / metallic マップは raw で来てほしいがタグなし
  - 影響: 非 color3 なマテリアルで色空間ズレ。glTF は per-texture colorSpace を持たないので真面目に直すには pixel-space の decode / re-encode が必要（低リスクだが対応は重い）
- [ ] MaterialX の別 surface shader — `ND_standard_surface_surfaceshader` (Arnold) / `ND_open_pbr_surface` の受理
- [ ] UsdPreviewSurface の `occlusion` / `ior` / `specularColor` 入力
- [ ] metallic と roughness が別アセットに authored されているケース（現状は同アセットなら emit、別アセットはスカラー fallback）
  - glTF は 1 枚の MR テクスチャしか受け付けないので、別アセットを combine したいときは load-time で合成する必要あり

**animation / skeleton**

- [ ] UsdSkelBlendShape の `inbetweens` (fractional weight targets)
- [ ] UsdSkel の `normalOffsets` (blend shape 法線デルタ — 現状は位置のみ)

**geometry**

- [ ] UsdGeomPointInstancer (未対応)
- [ ] UsdGeomNurbsCurves / BasisCurves (髪・ワイヤフレーム)
- [ ] UsdGeomSubdivisionSurface (Pixar Kitchen_set など)
- [ ] UsdGeomPoints (point-cloud primvar → glTF points mode)

**lights / camera**

- [ ] UsdGeomCamera orthographic projection (両 backend とも未対応; 現状常に perspective)
- [ ] UsdLux DiskLight / RectLight / CylinderLight (glTF の area light 拡張必要)
- [ ] UsdLux DomeLight → environment map (IBL)
- [ ] UsdLux SphereLight の `shaping:cone:*` → glTF spot light

**infrastructure / UX**

- [ ] Variant set selection UI (現状 `defaultPrim` の default variant)
- [ ] Stage 開閉時のキャッシュ（同じ USDZ の連続 open で shim 再 init を避ける）
- [ ] EXR / HDR / TGA / DDS テクスチャの正式対応（現状 `guess_image_mime` 側で rejected）
- [ ] Multi-stage composition (`references` / `payloads` が外部 USD を指すアセット)

**ビルド / 配布**

- [ ] `OPENUSD_PREBUILT_DIR` env 経由でのビルド済み OpenUSD 取り込み（30 分短縮）
- [ ] Linux 向け C++ backend 復活（vcpkg usd port が Linux 安定したら）

---

## 実装履歴

Phase 0 〜 7 は `yohawing/openusd` fork (pure Rust) 側の実装記録。
`backend-openusd-rs` feature が有効なときに走る経路。

C++ backend (Phase 1 / 2.A〜2.L) は [`docs/usd-cpp.md`](./usd-cpp.md) を参照。

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
5. ✅ Web Worker scaffold を `VITE_USD_WORKER=1` で有効化できる状態で用意（Phase 2 時点 default OFF。Phase 3 完了後 #45 で default ON、`VITE_USD_WORKER=0` で OFF）

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

### Web Worker（default ON、#45）

- `src/workers/usdLoader.worker.ts` — USDLoader.parse → `Group.toJSON()` を worker 内で実行
- `src/viewer/usdWorkerLoader.ts` — worker 呼び出し + `ObjectLoader` 再構築 wrapper
- 失敗時は同期 parse にフォールバック。binary buffer は `slice(0)` でコピーして渡す（transfer で detach しない）
- Phase 3 完了後、worker が触るのは単一バッファ USDA のみ（USDC・USDZ・composition は Rust GLB 経路に流れる）。toJSON/fromJSON の lossy 領域から外れたため #45 で default ON に切替えた
- `VITE_USD_WORKER=0` を build 時に渡すと worker を OFF にできる。worker-only な回帰を bisect するときの escape hatch

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

## Phase 6 — マテリアル詳細（実装済 / 家で検証待ち）

### 目的

Phase 5 の「既知の制約」のうち、**マテリアル系で実アセットに影響の大きい 4 項目**を Rust fork に実装した。C++ backend への port は Phase 9 で後追い、fork の変更は upstream PR 候補。

### スコープと完了状況

| サブフェーズ | 機能                                             | 状態 | 実コミット                                                                       |
| ------------ | ------------------------------------------------ | ---- | -------------------------------------------------------------------------------- |
| **6a**       | Normal map (`inputs:normal` 1-hop)               | ✅   | `e973b6a loader: resolve UsdPreviewSurface normal input`                         |
| **6b**       | UsdTransform2d (texture tile / offset)           | ✅   | `7256448 loader: apply UsdTransform2d to UV coordinates`                         |
| **6c**       | per-vertex displayColor → COLOR_0                | ✅   | `bb5a414 test: cover per-vertex displayColor → glTF COLOR_0`                     |
| **6c.2**     | PrimvarReader_float2 custom UV (st2…)            | 🚧   | deferred — MeshData に secondary UV フィールドがなく、fork 側拡張が必要          |
| **6d**       | UsdSkelBlendShape → GLB morph targets            | ✅   | `6fc3120 glb: wire morph-target plumbing` + `f3a4949 loader: emit morph targets` |
| **6d.2**     | BlendShape animation (`blendShapeWeights` track) | 🚧   | deferred — SkelAnimationData に weight track がなく、fork 側拡張が必要           |

### 6a. Normal map — 実装ノート

- fork は改変せず、yw-look 側で shader graph を walk（`find_preview_surface_shader` + `follow_texture_connection_to_asset`）
- base color テクスチャと同じ `TextureLoader` + `texture_dedup` を共有、同一画像が両チャンネルで参照されても 1 枚しか埋込まない
- glTF では `material.normalTexture`（`pbrMetallicRoughness` の外）として出力
- scale パラメータ（UsdUVTexture 側の `inputs:scale`）は Phase 10 に延期

### 6b. UsdTransform2d — 実装ノート

- `inputs:scale` / `rotation` / `translation` を読んで glTF `KHR_texture_transform` に変換
- USD の rotation (degrees) → glTF (radians) 変換はリゾルブ時に実施
- Identity transform は emit しない（GLB 最小化）
- 各テクスチャ参照 (`baseColorTexture` / `normalTexture`) に個別に付く
- top-level `extensionsUsed` への登録も自動
- 共通 helper: `follow_connection_to_shader` / `shader_is_texture_node` / `read_scalar_input` / `read_vec2_input`

### 6c. per-vertex displayColor — 実装ノート

- per-vertex displayColor → GLB `COLOR_0` のパスは Phase 5a 時点ですでに実装済みだったが、CI で pin されていなかった
- 本フェーズでは 2 本のユニットテストで挙動を明文化
  - `extract_geometry_emits_color_0_for_per_vertex_display_color`
  - `extract_geometry_omits_color_0_for_constant_display_color`（constant 色が `baseColorFactor` + COLOR_0 の二重適用にならないことを保証）

### 6c.2. PrimvarReader 経由の custom UV — 保留理由

- `primvars:st2` など secondary UV セット → `TEXCOORD_1` の経路は、fork の `MeshData` が UV を `Option<Vec<f32>>` 1 本しか持たないため **fork 側拡張が必要**
- 必要な変更: `MeshData.secondary_uvs: HashMap<String, Vec<f32>>` 追加 + mesh_of 側の抽出、yw-look 側で PrimvarReader → primvar 名 → secondary UV ルーティング
- 優先度高いアセットが出てきたら着手（chameleon USDZ の複数 UV セットが該当する可能性）

### 6d. UsdSkelBlendShape → morph targets — 実装ノート

- 2 コミット構成: `6fc3120` で plumbing（`MorphTarget` struct、`MeshInput.morph_targets / morph_weights`、GLB JSON 出力）、`f3a4949` で walker + 統合
- fork は改変せず yw-look 側で walk: `skel:blendShapeTargets` リレーション → `UsdSkelBlendShape` prim の `offsets` + `pointIndices`
- Sparse authoring（`pointIndices` あり）は dense per-vertex 配列に展開してから triangle-soup 展開ループに流す（既存の `mesh_data_to_input` ループに morph_corner_offsets アキュムレータを追加）
- GLB `primitive.targets[0].POSITION` + `mesh.weights` (rest pose = 0.0) + `mesh.extras.targetNames` を出力
- **スコープ外（6d.2 以降）**: normalOffsets / inbetweens / SkelAnimation の `blendShapeWeights` time sample → glTF animation track

### 検証（家で実行）

```sh
cd src-tauri
cargo test --lib usd::openusd_backend::tests::extract_geometry_embeds_normal_map_texture
cargo test --lib usd::openusd_backend::tests::extract_geometry_applies_usd_transform_2d
cargo test --lib usd::openusd_backend::tests::extract_geometry_without_transform2d_omits_extension
cargo test --lib usd::openusd_backend::tests::extract_geometry_emits_color_0_for_per_vertex_display_color
cargo test --lib usd::openusd_backend::tests::extract_geometry_omits_color_0_for_constant_display_color
cargo test --lib usd::openusd_backend::tests::extract_geometry_emits_morph_target_for_blend_shape
cargo test --lib usd::openusd_backend::tests::extract_geometry_omits_morph_when_no_blend_shapes
```

実アセット確認:

- glove_baseball.usdz — normal map が効いていること（目視 / DCC 比較）
- 自作の UsdTransform2d 付きアセット — UV が正しくタイル / オフセットすること
- 自作の UsdSkelBlendShape 付き rigged mesh — weight をスライダで動かすと形状が変わること（Three.js AnimationMixer 経由）

---

## Phase 7 — シーン完成度（実装中）

### 目的

アセット単体の描画だけでなく、USD が記述している**シーン状態（ライト・カメラ・可視性切替）**を viewer に反映する。

| サブフェーズ | 機能                          | 状態 | 実コミット                                                                                                                                                |
| ------------ | ----------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **7a**       | UsdLuxLight → Three.js lights | ✅   | `8ff1225 loader: resolve UsdLux lights to KHR_lights_punctual` (DistantLight / SphereLight のみ)                                                          |
| **7b**       | UsdGeomCamera 列挙 + 切替 UI  | ✅   | `ce0404e loader: enumerate UsdGeomCamera prims as glTF cameras` (backend emission のみ、frontend 切替 UI は別途)                                          |
| **7c**       | Purpose 切替 UI               | 🚧   | 未着手 — backend の `is_renderable_mesh` は `proxy`/`guide` を hard filter、`extract_geometry_glb` に purpose mode パラメータと frontend toggle UI が必要 |

### 7a. Lights — 実装ノート

- yw-look 側 walker (`resolve_lights` + `detect_light_kind`): `stage.traverse` → typeName 判定 → `inputs:color` / `inputs:intensity` / `inputs:exposure` 読取 → world xform 合成 → glTF `KHR_lights_punctual` へ変換
- intensity には `exposure` を `intensity * 2^exposure` で事前適用
- 対応: **DistantLight → directional**、**SphereLight → point**
- 延期: **RectLight / DiskLight / CylinderLight**（glTF に area light が無い、`KHR_lights_area` は draft）、**DomeLight**（env map パイプラインで扱うべき）、**spot 形状**（`shaping:cone:angle` 読取）
- `extensionsUsed` への `KHR_lights_punctual` 追加は 6b の `KHR_texture_transform` と additive に共存
- Z-up → Y-up 補正はライトノードにも適用、方向が mesh と一致

### 7b. Cameras — 実装ノート

- yw-look 側 walker (`resolve_cameras`): `Camera` prim を列挙、`focalLength` / `horizontalAperture` / `verticalAperture` / `clippingRange` を mm/float2 として読取
- glTF 変換: `yfov = 2 * atan(vAperture / (2 * focal))` (ラジアン)、`aspectRatio = hAperture / vAperture`
- `zfar` は `clippingRange[1]` が authored 時のみ emit（glTF の infinite-far-plane default を尊重）
- default 値は 35mm フィルム換算（36×24mm, 50mm）で spec デフォルトに合わせる
- 延期: **orthographic projection**（USD `projection = "orthographic"` → glTF `orthographic` への分岐コード必要）、**frontend 側のカメラ切替 UI**（GLB は `gltf.cameras[]` で提供済み、frontend が dropdown を実装すれば動く）

### 7c. Purpose 切替 — 未着手の計画

**現状**: `is_renderable_mesh` が `proxy` / `guide` purpose を hard filter してしまうので、`extract_geometry_glb` の時点でそれらの mesh は存在しない。

**必要なもの**:

1. Backend: `is_renderable_mesh` を relaxed mode に切替可能にする（purpose フィルタをパラメータ化）
2. `MeshInput` / GLB `node.extras.purpose` にタグ emit
3. Frontend: `default` / `render` / `proxy` / `guide` のチェックボックス UI、node 走査で `visible` トグル
4. Wire 型: `extract_geometry_glb(path, policy, purpose_filter)` の 3 引数化、frontend → Tauri command 経路

**優先度**: 7a/7b より低い（実アセットで proxy/guide を見たい場面が限定的）。別セッションで着手予定。

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

| サブフェーズ | 機能                | 概要                                                               |
| ------------ | ------------------- | ------------------------------------------------------------------ |
| **8a**       | PointInstancer      | scatter された mesh を GLB `EXT_mesh_gpu_instancing` で出力        |
| **8b**       | UsdGeomPoints       | 点群 → Three.js `Points` or glTF `POINTS` primitive                |
| **8c**       | UsdGeomBasisCurves  | カーブ・髪・リボン → Three.js `Line2` 系                           |
| **8d**       | Geometry primitives | Sphere / Cube / Cylinder / Cone / Capsule → Three.js 標準 geometry |

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

| サブフェーズ | 機能                               | 概要                                                              |
| ------------ | ---------------------------------- | ----------------------------------------------------------------- |
| **10a**      | Multi-hop shader graph             | UsdShadeNodeGraph の wrapping、任意 hop の texture / primvar 解決 |
| **10b**      | MaterialX ノード拡充               | `ND_convert_*` / `ND_multiply_*` / `ND_mix_*` 等の標準ノード      |
| **10c**      | USDZ 内 EXR / DDS / TGA テクスチャ | 既存 `TextureLoader` の対応フォーマット拡張                       |
| **10d**      | UsdVol (volumetric)                | OpenVDB 連携。Three.js 側の volume rendering 実装込み             |

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
