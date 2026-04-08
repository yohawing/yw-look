# USD Phase 0 PoC レポート

## 目的

`yw-look` の USD 対応方針 (`表示は Three.js / 検査は Rust`) を踏まえ、Rust 側 inspector の実装基盤として `mxpv/openusd` (crates.io: `openusd 0.2.0`) が使えるかを **fork する前に** 確認する。

判断したいこと:

- USDA / USDC / USDZ が現実のアセットで読めるか
- composition (`references` / `payloads` / `subLayers`) が動くか
- Windows MSVC でビルドが通るか
- `inspect_stage` / `summarize_stage` / `collect_asset_issues` を組める API があるか
- fork して足すべき機能の見積もり

## 検証環境

- OS: Windows 11
- Toolchain: `rustc 1.94.0` / `cargo 1.94.0` (stable-x86_64-pc-windows-msvc)
- Crate: `openusd = "0.2"` (released 2026-04-06)
- PoC コード: `experiments/usd-poc/` (yw-look 本体から隔離した独立 Cargo project、リポジトリには含まれていません)

## ビルド事情

- `openusd 0.2` の依存ツリーは **pure Rust のみ**
- 主要な transitive deps: `memchr`, `log`, `simd-adler32`, `fnv`, `hashbrown`, `anyhow`, `typed-path`, `heck`, `equivalent`
- C++ FFI (`bindgen`, `cmake`, `cc`, `openssl-sys`) なし
- Windows MSVC で build / run まで成功

これは「OpenUSD C++ ラッパー系の crate にありがちな Windows ビルド地獄」を回避できていることを意味し、yw-look の配布要件と相性が良い。

## 検証アセット

| ID | パス | 形式 | 性質 |
|---|---|---|---|
| `usda-tiny-sanity` | `samples/assets/usd/tiny.usda` | USDA 単体 | 自作 sanity asset。`defaultPrim` / `upAxis` / `metersPerUnit` 明示 |
| `usd-kitchen-set` | `samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd` | USDA root + USDC `*.geom.usd` | Pixar Kitchen Set。`references` と `payloads` 多用 |
| `usd-kitchen-set-instanced` | `Kitchen_set_instanced.usd` | USDA + native instancing | `instanceable = true` を使う variant |
| `usdz-arkit-chameleon` | `chameleon_anim_mtl_variant.usdz` | USDZ (ZIP) | Apple AR Quick Look サンプル。アニメ + variant |
| `usdz-arkit-glove` | `glove_baseball_mtl_variant.usdz` | USDZ (ZIP) | Apple AR Quick Look サンプル。variant |

## 結果マトリクス

| アセット | `Stage::open` | `default_prim` | `layer_count` | `root_prims` | `traverse` 完走 prim 数 |
|---|---|---|---|---|---|
| `tiny.usda` | ✅ | `"Root"` | 1 | 1 | 2 |
| `Kitchen_set.usd` | ✅ | `"Kitchen_set"` | **229** | 77 | **2048** |
| `Kitchen_set_instanced.usd` | ❌ | — | — | — | — |
| `chameleon_anim_mtl_variant.usdz` | ✅ | `"Root"` | 1 | 1 | 203 |
| `glove_baseball_mtl_variant.usdz` | ✅ | `"glove_baseball"` | 1 | 1 | 67 |

### Kitchen Set の意味

`layer_count = 229` で composed されたことは大きい。これが意味するのは:

- USDA root layer がパースされた
- 参照先の `*.geom.usd` (USDC binary, 228 個) が再帰的に解決された
- `references` と `payloads` を辿って composition tree に組み込めた
- 77 root prims / 2048 prims の depth-first traverse が完走した

USDA + USDC + composition arc がすべて動く 1 つの実証ケース。

### 唯一の失敗

`Kitchen_set_instanced.usd` は次のエラーで `Stage::open` に失敗:

```
failed to parse USDA layer
Caused by:
    0: Unable to parse prim metadata
    1: Unable to parse prim metadata entry
    2: Unsupported prim metadata: instanceable
```

USDA parser が prim metadata の `instanceable = true` をまだ知らない。アーキテクチャの欠陥ではなく、parser の認識キーが 1 つ足りないだけ。**upstream PR 1 本で塞げる粒度**。

## API 観察

### 直接 accessor が存在するもの

| 機能 | API |
|---|---|
| stage を開く | `Stage::open(&resolver, path) -> Result<Self>` |
| `defaultPrim` 読み | `stage.default_prim() -> Option<String>` |
| 合成済みレイヤ列挙 | `stage.layer_identifiers() -> &[String]` |
| レイヤ数 | `stage.layer_count() -> usize` |
| root prim 列挙 | `stage.root_prims() -> Result<Vec<String>>` |
| prim 走査 | `stage.traverse(visitor) -> Result<()>` |
| 汎用 metadata 読み | `stage.field::<T>(path, field) -> Result<Option<T>>` |
| spec 種別 | `stage.spec_type(path) -> Option<SpecType>` |
| asset resolver | `ar::DefaultResolver::new()` |

### 汎用 API 経由が必要なもの (= fork PR の自然な単位)

| 機能 | 現状 | 提案する upstream PR |
|---|---|---|
| `upAxis` 読み | `stage.field::<String>(...)` で取れるはず | `stage.up_axis() -> Option<UpAxis>` |
| `metersPerUnit` 読み | 同上 | `stage.meters_per_unit() -> Option<f64>` |
| `references` 列挙 | 自前で field 経由 | `stage.references_in(path) -> Vec<Reference>` |
| `payloads` 列挙 | 自前で field 経由 | `stage.payloads_in(path) -> Vec<Payload>` |
| 解決失敗アセット検出 | resolver 越しに自前で確認 | `stage.unresolved_assets() -> Vec<String>` |
| `instanceable` prim metadata | USDA parser で未対応 | parser に metadata key 追加 |

## 判定: **Go**

- 実アセット 5 件中 4 件が動作
- USDA / USDC / USDZ / references / payloads が全て 1 つの crate で実証済み
- Windows MSVC ビルドの障害なし
- 失敗ケース 1 件は upstream PR 1 本で塞げる粒度
- 直接 accessor がない項目もすべて generic `field()` 経由で実装可能

Phase 1 へ進む。

## Phase 1 に持ち込むべきこと

### Fork で最初に投入する PR (upstream にも価値があるもの)

1. **`instanceable` prim metadata 対応** — USDA parser の認識キー追加。検証アセット: `Kitchen_set_instanced.usd`
2. **`stage.up_axis()` accessor** — root layer の `upAxis` を `enum UpAxis { Y, Z }` で返す
3. **`stage.meters_per_unit()` accessor** — root layer の `metersPerUnit` を `f64` で返す
4. **`stage.references_in(path)` / `payloads_in(path)`** — composition arc の列挙 API
5. **`stage.unresolved_assets()`** — resolver で解決できなかった asset path のリスト

### yw-look 側で先に作るもの

- `UsdBackend` trait (`src-tauri/src/usd/backend.rs`) — 抽象境界
- `OpenusdBackend` 実装 — fork 版 `openusd` を呼ぶ
- Tauri command `inspect_stage` / `summarize_stage` / `collect_asset_issues`
- フロントエンド側 USD インスペクタ UI (Phase 1 後半)

### Phase 2 (UX) に積む宿題

PoC で扱った範囲ではないが、計画上忘れない:

- Three.js `USDLoader().parse(buffer)` の同期ブロッキングを崩す
  - 最低でも summary 表示後に Three.js parse を開始
  - 可能なら Web Worker への分離

## Exit rule (再掲)

- upstream PR 5 本のうち過半が 3 ヶ月以内に merge されない、もしくは USDC 系のクリティカルな破綻が判明した場合 → fork 常用をやめ、`yw-look/src-tauri` 側に必要最小限の inspector を inline で持つ方針に切り替える
- その判断ポイントは Phase 1 の中盤 (PR 提出から 6 週後) に一度レビューする

## 再現手順

> **注意**: `experiments/usd-poc/` ディレクトリはリポジトリに含まれていません（`.gitignore` で除外）。
> PoC を再現するには、独立した Cargo project として自分で作成する必要があります。
> 詳細は本ドキュメントの「実装詳細」セクションを参照してください。

```sh
# 例: 独自に PoC project を作成した場合の実行方法
cd /path/to/your/usd-poc
cargo run --release
```

引数を省略すると `samples/` 配下の Phase 0 アセットを順に開く。個別アセットは `cargo run --release -- <path>` で指定できる。
