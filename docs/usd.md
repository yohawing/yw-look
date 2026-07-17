# USD backend

`yw-look` は `backend-openusd-rs` を唯一の既定 USD backend として使う。実装は
`src-tauri/src/usd/openusd_backend.rs` と local `openusd` Rust dependency で完結し、
通常の `cargo check`、Tauri build、配布 bundle に OpenUSD native runtime は不要である。

## 確認済みの採用範囲

| 機能 | 状態 | 根拠 |
| --- | --- | --- |
| USDA / USDC / USDZ の stage 読み込み、階層、reference | 対応 | `OpenusdBackend` の stage / GLB tests |
| mesh、xform、material、texture、display color / opacity | 対応 | `extract_geometry_*` tests |
| skin、Skel animation、blend shape の静的 target | 対応 | `extract_geometry_emits_skin_and_animation`、`extract_geometry_emits_morph_target_for_blend_shape` |
| DistantLight / SphereLight と camera の GLB 出力 | 対応 | `extract_geometry_emits_khr_lights_punctual`、`extract_geometry_emits_authored_cameras` |
| payload の load / unload session | 対応 | `tests/rust_backend_payload_session.rs` と `tiny_payload.usda` |
| variant authored値の検査 | 対応 | `inspect_stage_reports_rust_backend_variant_selection` |

代表 fixture は `samples/assets/usd/` に置く。Rust backend のテストは少なくとも
`tiny.usda`、`tiny_material.usda`、`tiny_payload.usda`、`tiny_rigged.usda`、
`tiny_rigged_blend.usda`、`tiny_timed.usda` を対象にする。

## 現在の制約

- PointInstancer preview は未対応で、検出時は警告してスキップする。
- variant selection を session override として変更する API は未対応。要求は
  `USD_INVALID_VARIANT_SELECTION` として失敗する。
- flatten USDA source export と、詳細な UsdLux inspector API は未対応。viewer は
  GLB から得られる light / camera 情報へフォールバックする。
- `inherits` / `specializes` と詳細 layer metadata は parser API の不足により
  完全には列挙できない。
- blend-shape weight animation と Skeleton root の composed world transform は
  parser 側の情報が不足するため未対応である。

これらは読み込み失敗を避けるため、可能な箇所では degraded result または明示的な
エラーにする。新しい USD 機能を追加する前に、対応 fixture と Rust backend の回帰
テストを追加してから `openusd` dependency 側の不足を判断する。

## 検証

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

Windows bundle の確認は `npm run bundle:win` を使う。USD backend 自体は C++
toolchain や OpenUSD DLL を要求しない。Alembic preview helper の再生成だけは
`docs/native-build.md` の手順に従う。
