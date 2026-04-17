# USD C++ ラッパー PoC（Option C / Inspector only）

## Context

yw-look は現在 USD パースを `yohawing/openusd` fork（pure Rust, `rev = 0419da04…`）に依存している。
docs/usd.md Phase 0〜5 で積み上げてきた資産だが、以下が中長期の懸念になっている:

- fork 側で手書きしてきた composition / xformOp / variant 対応が upstream 互換から離れやすい
- USDC 復号や MaterialX / Hydra 準拠の更新を自前で追う必要がある
- fork の PR merge 進行に依存した運用が固定化している

**目的**: Pixar 公式 OpenUSD C++ を境界を狭く切った C shim 経由で呼び、`UsdBackend` 実装を 1 つ増やすことで fork 依存を段階的に剥がせる状態にする。
今回のゴールは PoC：Windows MSVC で公式 USD を実運用に載せられるかの地雷（ビルド・配布・起動時間・ランタイム依存）を踏み切るところまで。

## アプローチ（Option C + vcpkg）

公式 OpenUSD を **vcpkg manifest で依存宣言**し、Microsoft/vcpkg が提供する `usd` port で各開発者 / CI がビルドする。手書き C shim を被せて bindgen で Rust から叩く。`UsdBackend` trait の後ろに 2 つ目の実装 `OpenusdCppBackend` を追加し、Cargo feature で切替。

```
pxr::UsdStage (via vcpkg) ──┐
                            ├── usd_c_shim (self-built) ── UsdBackend trait ── Tauri
openusd (pure Rust fork)  ──┘    ↑ feature = "backend-openusd-cpp" で差替
```

vcpkg を選んだ理由（F3D / Blender / pxr_rs 等の survey を経て）:

- **リポジトリが軽い**: バイナリ vendoring も LFS も不要。`vcpkg.json` 1 個で宣言
- **バージョン更新が宣言的**: `vcpkg.json` を 1 行書き換えて commit するだけ
- **Rust USD 周辺コミュニティ (pxr_rs 等) は vendored build が主流**で、文化的に揃う
- **OpenUSD バイナリを我々が直接再配布しない**（MSI/.app への同梱は引き続き必要で、ライセンス表記は別途対応）

代償:

- 初回 `cargo build --features backend-openusd-cpp` は **30〜60 分**（OpenUSD のソースビルド）。2 回目以降は vcpkg の binary cache で 10 秒台
- CI では GitHub Actions Cache を `VCPKG_BINARY_SOURCES` に繋いで初回コストを抑える
- vcpkg の `usd` port は v25.5.1 (2025/6) 以降を pin（v25.2 に Python リンクの既知問題があったため）

### PoC で実装する UsdBackend メソッド

| メソッド               | 実装                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `inspect_stage`        | ✅ C shim 経由で実装                                                      |
| `summarize_stage`      | ✅ C shim 経由で実装                                                      |
| `collect_asset_issues` | ✅ C shim 経由で実装                                                      |
| `root_layer_is_binary` | ✅ 診断用、薄い                                                           |
| `requires_glb_preview` | ⏸ 常に `false` を返す or Rust backend にフォールバック（PoC 範囲外）      |
| `extract_geometry_glb` | ⏸ `UsdError::Parse("geometry pipeline is phase 2 of cpp backend")` を返す |

geometry / material / skel は **PoC 合格後の次フェーズ**。Rust fork 実装は残す。

### 対象プラットフォーム

- **Windows MSVC x64 /MD**
- **macOS arm64**（Apple Silicon, 開発機想定）
- macOS x86_64 は後追い（必要なら `lipo` で universal 化、または別 dylib）
- Linux は未対応（将来別ブランチで）
- feature OFF（default）ビルドは全 OS で変更なしで通ること

## ファイルレイアウト

```
src-tauri/
├── Cargo.toml                              # feature 追加
├── build.rs                                # vcpkg 起動 → shim ビルド → リンク
├── vcpkg.json                              # NEW: OpenUSD 依存を宣言
├── vcpkg-configuration.json                # NEW: registry baseline を pin
├── src/
│   └── usd/
│       ├── backend.rs                      # 変更なし（trait は既に抽象化済み）
│       ├── openusd_backend.rs              # 既存（default feature）
│       ├── openusd_cpp_backend.rs          # NEW: C shim を叩く実装
│       ├── cpp_sys/
│       │   ├── mod.rs                      # NEW: bindgen エントリ + 安全ラッパ
│       │   └── wrapper.h                   # NEW: shim ヘッダの include 口
│       └── mod.rs                          # feature に応じて backend を差替
└── third_party/
    └── usd_c_shim/                         # NEW: 自前 C++ shim のソース
        ├── CMakeLists.txt
        ├── include/usd_c_shim.h            # opaque handle + flat C functions
        └── src/usd_c_shim.cpp              # UsdStage / traverse / field 読みの薄い移植

# vcpkg の成果物はすべて .gitignore
.gitignore                                  # src-tauri/vcpkg_installed/ を追加
docs/usd-cpp.md                             # NEW: ビルド手順・運用 / PoC 結果
tauri.*.json                                # NEW: OS 別に vcpkg_installed/ の DLL を bundle.resources に指定
```

vendor/ ツリーは作らない。OpenUSD バイナリは `src-tauri/vcpkg_installed/<triplet>/` に落ちる（gitignored）。

## 実装手順

### Step 1: `usd_c_shim` の C++ 設計 + ビルド（ローカル）

1. `third_party/usd_c_shim/` 新規作成
2. `include/usd_c_shim.h` で opaque handle を定義:
   ```c
   typedef struct UsdcStage_s UsdcStage;
   typedef struct UsdcError_s UsdcError;
   UsdcStage* usdc_stage_open(const char* path, int load_policy, UsdcError** out_err);
   void       usdc_stage_close(UsdcStage*);
   const char* usdc_stage_default_prim(UsdcStage*);
   int         usdc_stage_up_axis(UsdcStage*);   // 0=Y, 1=Z
   double      usdc_stage_meters_per_unit(UsdcStage*);
   int         usdc_stage_root_layer_is_binary(UsdcStage*);
   size_t      usdc_stage_layer_count(UsdcStage*);
   // 列挙系は callback 形式
   void        usdc_stage_traverse(UsdcStage*, void(*cb)(const char* path, void* user), void* user);
   void        usdc_stage_layer_identifiers(UsdcStage*, void(*cb)(const char*, void*), void*);
   void        usdc_stage_references_in(UsdcStage*, const char* prim_path, UsdcArcCallback, void*);
   void        usdc_stage_payloads_in(UsdcStage*, const char* prim_path, UsdcArcCallback, void*);
   void        usdc_stage_unresolved_assets(UsdcStage*, UsdcStringCallback, void*);
   void        usdc_stage_skipped_payloads(UsdcStage*, UsdcArcCallback, void*);  // prim-aware: (asset_path, source_prim) per emission
   int         usdc_prim_has_variants(UsdcStage*, const char* prim_path);
   int         usdc_prim_type_is_mesh(UsdcStage*, const char* prim_path);
   ```
   Inspector に必要な読み取り系のみ。返す文字列は shim 内部の `thread_local std::string` or 呼び出し側が C 文字列を安全にコピーする運用。
3. `src/usd_c_shim.cpp` で `pxr::UsdStage::Open` を呼び、`PrimRange` / `UsdPrim::GetReferences` / `UsdPayloads` / `GetVariantSets` を薄くラップ。例外は `catch(...)` で `UsdcError` に詰めて返す（FFI 境界で例外を漏らさない）。
4. CMake で OpenUSD を `find_package(pxr CONFIG)` で引く。monolithic prebuild の install prefix をユーザー環境変数 `OPENUSD_ROOT` で受ける。出力は `usd_c_shim.dll`。

### Step 2: vcpkg manifest で OpenUSD を依存宣言

`src-tauri/vcpkg.json`:

```json
{
  "name": "yw-look",
  "version-string": "0.1.0",
  "dependencies": [{ "name": "usd", "version>=": "25.05.1" }],
  "builtin-baseline": "<vcpkg repo commit SHA>"
}
```

`src-tauri/vcpkg-configuration.json`:

```json
{
  "default-registry": {
    "kind": "git",
    "repository": "https://github.com/microsoft/vcpkg",
    "baseline": "<vcpkg repo commit SHA>"
  }
}
```

- `version>=` で v25.2 の Python リンク不具合版を避ける
- `builtin-baseline` / `default-registry.baseline` に vcpkg リポジトリの commit SHA を入れて「この版の port tree を使う」と固定。ロックファイル的な挙動になり、CI と開発者で完全に同じ USD 版が入る
- port の feature（imaging / usdview / python 等）は明示指定しない → port 側の default ON 項目のみ取り込む。必要に応じて後で絞る

#### 開発者セットアップ（初回のみ）

```sh
# 1. vcpkg をどこか固定の場所に clone（~/.vcpkg 推奨）
git clone https://github.com/microsoft/vcpkg ~/.vcpkg
~/.vcpkg/bootstrap-vcpkg.sh       # Windows: bootstrap-vcpkg.bat

# 2. 環境変数
export VCPKG_ROOT=$HOME/.vcpkg    # Windows: setx VCPKG_ROOT %USERPROFILE%\.vcpkg

# 3. 初回ビルド（OpenUSD を source build、30-60 分）
cd yw-look/src-tauri
cargo build --features backend-openusd-cpp
```

#### Triplet

| OS          | triplet       | 備考                                                    |
| ----------- | ------------- | ------------------------------------------------------- |
| Windows     | `x64-windows` | dynamic CRT (/MD) がデフォルト。Tauri の runtime と揃う |
| macOS arm64 | `arm64-osx`   | Apple Silicon                                           |

#### CI での高速化

GitHub Actions で vcpkg binary cache を Actions Cache に載せる:

```yaml
env:
  VCPKG_BINARY_SOURCES: "clear;x-gha,readwrite"
# cache key は vcpkg.json + vcpkg-configuration.json のハッシュ
```

初回の 30〜60 分は 1 回だけ。以降は `vcpkg install` が数秒で通る。

#### macOS 配布時の追加処理

`.app` に dylib を埋め込む際:

- **rpath 調整**: `install_name_tool -add_rpath @executable_path/../Frameworks yw-look` で `Contents/Frameworks/` を探索させる
- **Ad-hoc codesign**: 各 dylib に `codesign --force --sign - <dylib>` を適用（正式 notarization は後続フェーズ）

#### 再配布ライセンス表記（MSI / .app 同梱分）

vcpkg では OpenUSD バイナリを我々が直接配布しないが、**最終的に MSI / .app に同梱する段階で再配布行為が発生**する。以下を MSI / .app の about ダイアログ or `Resources/licenses/` に含める:

- OpenUSD `LICENSE.txt` (Tomorrow Open Source Technology License 1.0 = Apache 2.0 改変版)
- oneTBB `LICENSE.txt` (Apache 2.0)
- monolithic build にリンクされた他の依存（Boost 等）のライセンス
- 依存ツリーは `vcpkg install --recurse` 実行時に出るログ or `vcpkg depend-info usd` で収集

### Step 3: Rust 側 FFI（`cpp_sys` モジュール）

1. `Cargo.toml` に新 feature:
   ```toml
   [features]
   default = ["backend-openusd-rs"]
   backend-openusd-rs = []
   backend-openusd-cpp = ["dep:bindgen", "dep:cmake"]
   ```
   openusd crate 依存は `backend-openusd-rs` feature に紐づけ、両立不可 feature として `compile_error!` ガード。
2. `src-tauri/build.rs` で feature 時のみ:
   - **vcpkg 起動** (`VCPKG_ROOT` 必須、`vcpkg install --x-manifest-root=.` をキック)
   - **shim ビルド** (`cmake` crate で `third_party/usd_c_shim/` を build、vcpkg の `CMAKE_TOOLCHAIN_FILE` を渡す)
   - **bindgen** で `third_party/usd_c_shim/include/usd_c_shim.h` → `OUT_DIR/usd_c_shim_bindings.rs`
   - **リンク指示**: shim + usd_ms を dylib リンク
3. `src/usd/cpp_sys/mod.rs` で bindgen 結果を include、Rust 側に `CStage` RAII ラッパを書く（Drop で `usdc_stage_close`）。callback は `extern "C" fn` + `*mut c_void` でクロージャを渡す定番パターン。

### Step 4: `OpenusdCppBackend` 実装

1. `src/usd/openusd_cpp_backend.rs` 新規作成。`UsdBackend` を impl。
2. 既存 `OpenusdBackend` の `inspect_stage` / `summarize_stage` / `collect_asset_issues` / `root_layer_is_binary` の**ロジック構造を写経**し、`openusd::Stage` の呼び出し部分だけ `cpp_sys::CStage` に置換。`CompositionArcState` 分類や `StageSummary` 生成ロジックは **yw-look 側の純粋関数なのでそのまま再利用**（関数を `mod.rs` に移して両 backend から呼べる形へ）。
3. `requires_glb_preview` → `Ok(false)` で固定（PoC では GLB 経路に乗せない）
4. `extract_geometry_glb` → `UsdError::Parse("...")`

### Step 5: backend 選択ロジック

`src/usd/mod.rs`:

```rust
#[cfg(all(feature = "backend-openusd-cpp", not(feature = "backend-openusd-rs")))]
pub type DefaultBackend = OpenusdCppBackend;

#[cfg(feature = "backend-openusd-rs")]
pub type DefaultBackend = OpenusdBackend;
```

`lib.rs` の `app.manage(UsdBackendState::new(OpenusdBackend::new()))` を `DefaultBackend::new()` に置き換え。

### Step 6: Tauri bundler へ shared library を同梱

vcpkg が吐いた DLL / dylib は `src-tauri/vcpkg_installed/<triplet>/{bin,lib}/` にある。これと `build.rs` が cmake crate 経由でビルドした shim をまとめて Tauri bundle に載せる。

`build.rs` が post-build で DLL / dylib を固定パス `src-tauri/target/cpp-artifacts/<triplet>/` にコピーしておき、`tauri.conf.json` はそこを参照する形にする（vcpkg のフォルダ名は triplet 依存なので、安定した参照先を作る）。

`tauri.windows.json`:

```json
"bundle": {
  "resources": [
    "target/cpp-artifacts/x64-windows/usd_ms.dll",
    "target/cpp-artifacts/x64-windows/tbb12.dll",
    "target/cpp-artifacts/x64-windows/usd_c_shim.dll"
  ]
}
```

`tauri.macos.json`:

```json
"bundle": {
  "macOS": {
    "frameworks": [
      "target/cpp-artifacts/arm64-osx/libusd_ms.dylib",
      "target/cpp-artifacts/arm64-osx/libtbb.12.dylib",
      "target/cpp-artifacts/arm64-osx/libusd_c_shim.dylib"
    ]
  }
}
```

macOS は `frameworks` に入れると `.app/Contents/Frameworks/` に配置される。shim ビルド時に `-Wl,-rpath,@loader_path/../Frameworks` を付けて `Contents/MacOS/yw-look` → `Contents/Frameworks/libusd_c_shim.dylib` → `libusd_ms.dylib` の解決を成立させる。feature OFF ビルドでは resources に含まれないよう、配布 CI で feature と config を同時に切替（PoC 中は手動で OK）。

### Step 7: ドキュメント

`docs/usd-cpp.md` 新規:

- ビルド前提（Visual Studio 2022, CMake, Python 3.11 for build_usd.py）
- `build_usd.py` コマンド一式
- vendor 更新手順
- PoC 結果マトリクス（下の検証結果を後で転記）
- Exit rule（PoC 失敗時の撤退条件）

## 再利用する既存コード

変更せずそのまま使える yw-look 純粋ロジック:

- `src/usd/types.rs` — wire types（`StageInspection` / `StageSummary` / `AssetIssue` / `CompositionArc` / `StageLoadPolicy`）。共通
- `src/usd/openusd_backend.rs` の arc state 分類 (`reference_arc_state`, `payload_arc_state`) — 関数として切り出して共通化
- Tauri command 層（`inspect_stage`, `summarize_stage`, `collect_asset_issues`）— `UsdBackend` trait 経由なので無変更

## 検証

### ビルド検証

```sh
# default（Rust fork）: 既存挙動と同じ
cd src-tauri && cargo build

# 新 backend: Windows / macOS それぞれで通ること
export VCPKG_ROOT=$HOME/.vcpkg   # 事前に clone + bootstrap 済み
cd src-tauri && cargo build --no-default-features --features backend-openusd-cpp

# Tauri app 実配布形態
npm run tauri build -- --config src-tauri/tauri.windows.json   # Windows
npm run tauri build -- --config src-tauri/tauri.macos.json     # macOS
```

確認ポイント:

- 初回 `cargo build --features backend-openusd-cpp` が `vcpkg install` を走らせて OpenUSD を source build すること（30〜60 分）
- 2 回目は vcpkg binary cache から秒で復元されること
- macOS ビルド時は `.app/Contents/Frameworks/` に 3 本の dylib が含まれ、`otool -L .../Contents/MacOS/yw-look` で `@rpath/libusd_c_shim.dylib` が解決すること
- Windows ビルド時は MSI 内部（7zip で覗く）に 3 本の DLL があること

### 機能検証（Phase 0 と同じアセット）

`experiments/usd-cpp-poc/` か、`cargo test --features backend-openusd-cpp` で以下を比較:

| アセット                          | `Stage::open`                                                                                     | `default_prim`     | `layer_count` | `root_prims` | traverse prim 数 |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ | ------------- | ------------ | ---------------- |
| `samples/assets/usd/tiny.usda`    | ✅                                                                                                | `"Root"`           | 1             | 1            | 2                |
| `Kitchen_set.usd`                 | ✅                                                                                                | `"Kitchen_set"`    | 229           | 77           | 2048             |
| `Kitchen_set_instanced.usd`       | **要確認**（Rust fork では USDA parser が instanceable を落として失敗していた。C++ なら通る想定） | —                  | —             | —            | —                |
| `chameleon_anim_mtl_variant.usdz` | ✅                                                                                                | `"Root"`           | 1             | 1            | 203              |
| `glove_baseball_mtl_variant.usdz` | ✅                                                                                                | `"glove_baseball"` | 1             | 1            | 67               |

成功条件:

1. 上記すべての `StageInspection` JSON が Rust fork backend の結果と **意味的に一致**（順序差は許容、件数は一致）
2. `Kitchen_set_instanced.usd` が C++ backend で開けるようになっていること（Rust fork に対する優位の実証）
3. アプリ起動後に USD を 10 ファイル連続で開いてもクラッシュしないこと（DLL ローダ / TBB スレッドプールの安定性）
4. **Windows**: MSI をクリーン Windows 11 環境にインストール → USD が開けること（C++ ランタイム不足などを踏み切る）
5. **macOS**: `.app` を別マシン（または `xattr -dr com.apple.quarantine` した clean prefix）にコピーして起動 → USD が開けること（ad-hoc codesign と rpath の検証）

### サイズ確認

- Windows MSI 増分 ≤ 80 MB
- macOS `.app` zip 増分 ≤ 80 MB
- 超えた場合は圧縮や plugin 絞込を検討

## Exit rule

以下のいずれかに該当したら **撤退し、Rust fork を引き続き default とする**:

1. `usd_ms.dll` + 依存の合計が 150 MB を超える
2. クリーン Windows 環境で起動できない（C++ ランタイム / side-by-side エラー）
3. クリーン macOS 環境で起動できない（ad-hoc codesign / rpath / quarantine で弾かれる）
4. C shim でクラッシュが 1 アセット / 1000 file open 以上の頻度
5. **vcpkg `usd` port の安定性が担保できない**: pin した baseline で両 OS 通らない、port の CMake fail が頻発、upstream fix が来ない
6. MSI / .app ビルド（CI の cache hit 時）に 3 分以上加算される（開発 DX が顕著に劣化）

vcpkg 固有の撤退時フォールバック: 前 revision の「自前 prebuild + GitHub Release 配布」案に戻せるよう、この PoC 計画の旧版は git 履歴から参照可能にしておく。

撤退時の成果物は `docs/usd-cpp.md` に「なぜ止めたか」を残し、`vcpkg.json` / shim ソース / 関連 feature / build.rs 分岐を削除する。

## ラッパー/バインディング詳細

全体は 4 層。上に行くほど Rust の安全な世界になる。

```
pxr::UsdStage (C++)
    ↕ C++ 側 (usd_c_shim.cpp) — 手書き
extern "C" な C 関数（opaque handle + callback 列挙）
    ↕ Rust 側 (build.rs + bindgen) — 自動生成
unsafe な extern "C" Rust 関数
    ↕ src/usd/cpp_sys/mod.rs — 手書き RAII ラッパ
安全な Rust 型 (CStage, UpAxis, ...)
    ↕ src/usd/openusd_cpp_backend.rs — 手書き
UsdBackend trait 実装
```

### 設計原則

- **C++ シンボルは 1 つも外に出さない**。境界はすべて `extern "C"`
- **例外は C++ 側で `catch(...)`** し `UsdcError*` に詰め替える。FFI 境界で例外を漏らすと UB
- **オブジェクトは opaque handle** (`typedef struct UsdcStage_s UsdcStage;`)。C 側から中身を見せない
- **可変長の列挙は callback 形式**。Vec を FFI で返すよりシンプルで所有権が明確
- **文字列返却は shim 内部の scratch バッファ**。Rust 側で即 `CStr::to_owned()` させる
- **cxx ではなく bindgen** を採用。C++ を直接バインドしない方がビルド要件が軽く、`UsdStageRefPtr` 等の smart pointer を隠せる

### 1 層目: C++ ヘッダ（`third_party/usd_c_shim/include/usd_c_shim.h`）

```c
#ifndef USD_C_SHIM_H
#define USD_C_SHIM_H
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct UsdcStage_s UsdcStage;
typedef struct UsdcError_s UsdcError;

const char* usdc_error_message(const UsdcError*);
void        usdc_error_free(UsdcError*);

typedef enum {
    USDC_LOAD_ALL         = 0,
    USDC_LOAD_NO_PAYLOADS = 1,
} UsdcLoadPolicy;

UsdcStage*  usdc_stage_open(const char* path, UsdcLoadPolicy, UsdcError** out_err);
void        usdc_stage_close(UsdcStage*);

const char* usdc_stage_default_prim(UsdcStage*);
int         usdc_stage_up_axis(UsdcStage*);           /* 0=Y 1=Z -1=unset */
double      usdc_stage_meters_per_unit(UsdcStage*);
int         usdc_stage_root_layer_is_binary(UsdcStage*);
size_t      usdc_stage_layer_count(UsdcStage*);

typedef void (*UsdcStringCallback)(const char* s, void* user);
typedef struct {
    const char* source_prim;
    const char* asset_path;
    const char* target_prim;  /* nullable */
    int         is_loaded;
} UsdcArc;
typedef void (*UsdcArcCallback)(const UsdcArc*, void* user);

void usdc_stage_traverse(UsdcStage*, UsdcStringCallback, void*);
void usdc_stage_layer_identifiers(UsdcStage*, UsdcStringCallback, void*);
void usdc_stage_references_in(UsdcStage*, const char* prim_path, UsdcArcCallback, void*);
void usdc_stage_payloads_in(UsdcStage*, const char* prim_path, UsdcArcCallback, void*);
void usdc_stage_unresolved_assets(UsdcStage*, UsdcStringCallback, void*);

int  usdc_prim_type_is_mesh(UsdcStage*, const char* prim_path);
int  usdc_prim_has_variants(UsdcStage*, const char* prim_path);

#ifdef __cplusplus
}
#endif
#endif
```

### 1 層目: C++ 実装（`third_party/usd_c_shim/src/usd_c_shim.cpp`, 骨子）

```cpp
#include "usd_c_shim.h"
#include <pxr/usd/usd/stage.h>
#include <pxr/usd/usdGeom/metrics.h>
#include <pxr/usd/usdGeom/tokens.h>

PXR_NAMESPACE_USING_DIRECTIVE

struct UsdcError_s { std::string msg; };
struct UsdcStage_s {
    UsdStageRefPtr stage;
    std::string    scratch;   /* 呼び出し毎に上書きして const char* を返す */
};

static UsdcError* make_err(const char* m) {
    auto e = new UsdcError_s(); e->msg = m; return e;
}

extern "C" UsdcStage* usdc_stage_open(const char* path, UsdcLoadPolicy p,
                                     UsdcError** out_err) {
    try {
        auto load = (p == USDC_LOAD_NO_PAYLOADS)
                    ? UsdStage::LoadNone : UsdStage::LoadAll;
        auto s = UsdStage::Open(path, load);
        if (!s) { *out_err = make_err("UsdStage::Open returned null"); return nullptr; }
        auto h = new UsdcStage_s(); h->stage = s; return h;
    } catch (const std::exception& e) { *out_err = make_err(e.what()); return nullptr; }
      catch (...) { *out_err = make_err("unknown exception"); return nullptr; }
}

extern "C" void usdc_stage_close(UsdcStage* h) { delete h; }

extern "C" const char* usdc_stage_default_prim(UsdcStage* h) {
    auto p = h->stage->GetDefaultPrim();
    if (!p) return nullptr;
    h->scratch = p.GetName().GetString();
    return h->scratch.c_str();
}

extern "C" void usdc_stage_traverse(UsdcStage* h, UsdcStringCallback cb, void* user) {
    try {
        for (const UsdPrim& p : h->stage->Traverse()) {
            std::string s = p.GetPath().GetAsString();
            cb(s.c_str(), user);
        }
    } catch (...) { /* best-effort, swallow */ }
}
```

### 1 層目: CMake（`third_party/usd_c_shim/CMakeLists.txt`）

```cmake
cmake_minimum_required(VERSION 3.22)
project(usd_c_shim CXX)
set(CMAKE_CXX_STANDARD 17)

find_package(pxr CONFIG REQUIRED)   # OPENUSD_ROOT/cmake を CMAKE_PREFIX_PATH に
add_library(usd_c_shim SHARED src/usd_c_shim.cpp)
target_include_directories(usd_c_shim PUBLIC include)
target_link_libraries(usd_c_shim PRIVATE usd_ms)

if(NOT WIN32)
    set_target_properties(usd_c_shim PROPERTIES CXX_VISIBILITY_PRESET hidden)
endif()
```

### 2 層目: `src-tauri/build.rs`（vcpkg 起動 + shim ビルド + bindgen）

```rust
fn main() {
    tauri_build::build();
    #[cfg(feature = "backend-openusd-cpp")]
    build_cpp_backend();
}

#[cfg(feature = "backend-openusd-cpp")]
fn build_cpp_backend() {
    use std::{env, path::PathBuf, process::Command};

    let vcpkg_root = env::var("VCPKG_ROOT")
        .expect("VCPKG_ROOT not set (install vcpkg and export VCPKG_ROOT)");
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let triplet = match target_os.as_str() {
        "windows" => "x64-windows",
        "macos"   => "arm64-osx",
        other => panic!("backend-openusd-cpp: unsupported target os {other}"),
    };

    // 1) vcpkg install (OpenUSD をビルド or binary cache から復元)
    let vcpkg_exe = if target_os == "windows" { "vcpkg.exe" } else { "vcpkg" };
    let status = Command::new(format!("{vcpkg_root}/{vcpkg_exe}"))
        .args(["install", "--x-manifest-root=.", &format!("--triplet={triplet}")])
        .current_dir(&manifest_dir)
        .status()
        .expect("vcpkg install failed");
    assert!(status.success(), "vcpkg install returned {status}");

    let installed = PathBuf::from(&manifest_dir).join("vcpkg_installed").join(triplet);

    // 2) shim を CMake crate でビルド。OpenUSD は vcpkg toolchain 経由で find_package
    let dst = cmake::Config::new("third_party/usd_c_shim")
        .define("CMAKE_TOOLCHAIN_FILE",
                format!("{vcpkg_root}/scripts/buildsystems/vcpkg.cmake"))
        .define("VCPKG_TARGET_TRIPLET", triplet)
        .build();

    // 3) bindgen
    let header = "third_party/usd_c_shim/include/usd_c_shim.h";
    println!("cargo:rerun-if-changed={header}");
    let bindings = bindgen::Builder::default()
        .header(header)
        .allowlist_function("usdc_.*")
        .allowlist_type("Usdc.*")
        .prepend_enum_name(false)
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect("bindgen failed");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("usd_c_shim_bindings.rs");
    bindings.write_to_file(&out).unwrap();

    // 4) link 指示
    println!("cargo:rustc-link-search=native={}", dst.join("lib").display());
    println!("cargo:rustc-link-search=native={}", installed.join("lib").display());
    println!("cargo:rustc-link-lib=dylib=usd_c_shim");
    println!("cargo:rustc-link-lib=dylib=usd_ms");
    if target_os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path/../Frameworks");
    }

    // 5) Tauri bundle 用 staging: vcpkg + shim の成果物を target/cpp-artifacts/<triplet>/ に集約
    // （コピー処理は省略。Windows は bin/*.dll、macOS は lib/*.dylib 対象）
}
```

bindgen の出力イメージ（`OUT_DIR/usd_c_shim_bindings.rs`、自動生成で触らない）:

```rust
pub type UsdcStringCallback = ::std::option::Option<
    unsafe extern "C" fn(s: *const ::std::os::raw::c_char, user: *mut ::std::os::raw::c_void),
>;
extern "C" {
    pub fn usdc_stage_open(
        path: *const ::std::os::raw::c_char,
        policy: UsdcLoadPolicy,
        out_err: *mut *mut UsdcError,
    ) -> *mut UsdcStage;
    pub fn usdc_stage_close(stage: *mut UsdcStage);
    pub fn usdc_stage_default_prim(stage: *mut UsdcStage) -> *const ::std::os::raw::c_char;
    pub fn usdc_stage_traverse(
        stage: *mut UsdcStage,
        cb: UsdcStringCallback,
        user: *mut ::std::os::raw::c_void,
    );
    /* ... */
}
```

### 3 層目: 安全 Rust ラッパ（`src-tauri/src/usd/cpp_sys/mod.rs`）

手書き部分。RAII と callback trampoline の 2 つが要点。

```rust
#![allow(non_camel_case_types, non_snake_case, dead_code)]
include!(concat!(env!("OUT_DIR"), "/usd_c_shim_bindings.rs"));

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::path::Path;

#[derive(Debug)]
pub struct CError(pub String);
impl std::fmt::Display for CError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for CError {}

#[derive(Copy, Clone, Debug)]
pub enum LoadPolicy { All, NoPayloads }
impl LoadPolicy {
    fn to_raw(self) -> UsdcLoadPolicy {
        match self {
            LoadPolicy::All        => UsdcLoadPolicy_USDC_LOAD_ALL,
            LoadPolicy::NoPayloads => UsdcLoadPolicy_USDC_LOAD_NO_PAYLOADS,
        }
    }
}

pub struct CStage { raw: *mut UsdcStage }
// 同一 stage を複数スレッドで同時に触らない運用。Tauri の blocking task で
// 1 stage / 1 スレッド使い捨てなので Send のみ付ける。Sync は付けない。
unsafe impl Send for CStage {}

impl CStage {
    pub fn open(path: &Path, policy: LoadPolicy) -> Result<Self, CError> {
        let c_path = CString::new(path.to_string_lossy().as_ref())
            .map_err(|_| CError("path contains NUL".into()))?;
        let mut err: *mut UsdcError = std::ptr::null_mut();
        let raw = unsafe { usdc_stage_open(c_path.as_ptr(), policy.to_raw(), &mut err) };
        if raw.is_null() {
            let msg = unsafe { CStr::from_ptr(usdc_error_message(err)) }
                .to_string_lossy().into_owned();
            unsafe { usdc_error_free(err) };
            return Err(CError(msg));
        }
        Ok(CStage { raw })
    }

    pub fn default_prim(&self) -> Option<String> {
        let p = unsafe { usdc_stage_default_prim(self.raw) };
        if p.is_null() { None }
        else { Some(unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()) }
    }

    pub fn up_axis(&self) -> Option<UpAxis> {
        match unsafe { usdc_stage_up_axis(self.raw) } {
            0 => Some(UpAxis::Y),
            1 => Some(UpAxis::Z),
            _ => None,
        }
    }

    /// traverse の結果を Vec<String> に溜める。callback trampoline の定石。
    pub fn traverse(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        unsafe {
            usdc_stage_traverse(
                self.raw,
                Some(string_trampoline),
                &mut out as *mut Vec<String> as *mut c_void,
            );
        }
        out
    }
}

unsafe extern "C" fn string_trampoline(s: *const c_char, user: *mut c_void) {
    let out = unsafe { &mut *(user as *mut Vec<String>) };
    let s = unsafe { CStr::from_ptr(s) }.to_string_lossy().into_owned();
    out.push(s);
}

impl Drop for CStage {
    fn drop(&mut self) { unsafe { usdc_stage_close(self.raw) } }
}

#[derive(Copy, Clone, Debug)]
pub enum UpAxis { Y, Z }
```

### 4 層目: `OpenusdCppBackend`（`src-tauri/src/usd/openusd_cpp_backend.rs`）

既存 `OpenusdBackend` の骨格を写し、openusd crate 呼び出し部分だけ `cpp_sys::CStage` に差し替える。純粋ロジック（`reference_arc_state` / `payload_arc_state` / `StageSummary` 組み立て）は **関数として切り出し両 backend から共有**する。

```rust
use super::backend::{UsdBackend, UsdError};
use super::cpp_sys::{CStage, LoadPolicy};
use super::types::{AssetIssue, StageInspection, StageLoadPolicy, StageSummary};
use std::path::Path;

pub struct OpenusdCppBackend;
impl OpenusdCppBackend { pub fn new() -> Self { Self } }

fn to_cpp(p: StageLoadPolicy) -> LoadPolicy {
    match p {
        StageLoadPolicy::LoadAll    => LoadPolicy::All,
        StageLoadPolicy::NoPayloads => LoadPolicy::NoPayloads,
    }
}

impl UsdBackend for OpenusdCppBackend {
    fn inspect_stage(&self, path: &Path, policy: StageLoadPolicy)
        -> Result<StageInspection, UsdError>
    {
        let stage = CStage::open(path, to_cpp(policy)).map_err(|e| UsdError::Parse(e.0))?;
        // 既存 openusd_backend.rs からくる共通関数に渡して StageInspection を組み立て
        Ok(build_inspection_from_stage_traits(&stage, path, policy))
    }
    /* summarize_stage / collect_asset_issues / root_layer_is_binary 同様 */
    fn requires_glb_preview(&self, _: &Path) -> Result<bool, UsdError> { Ok(false) }
    fn extract_geometry_glb(&self, _: &Path, _: StageLoadPolicy) -> Result<Vec<u8>, UsdError> {
        Err(UsdError::Parse("geometry pipeline not implemented for cpp backend".into()))
    }
}
```

### コード量の見込み

| 層                                             | 書き方             | LOC           |
| ---------------------------------------------- | ------------------ | ------------- |
| C++ → C shim header                            | 手書き             | ~80           |
| C++ → C shim 実装                              | 手書き             | ~300          |
| CMakeLists.txt                                 | 手書き             | ~30           |
| vcpkg.json / vcpkg-configuration.json          | 手書き             | ~30           |
| build.rs（vcpkg 起動 + cmake crate + bindgen） | 手書き             | ~80           |
| bindgen 生成バインディング                     | 自動               | 0（OUT_DIR）  |
| 安全 Rust ラッパ（`cpp_sys/mod.rs`）           | 手書き             | ~200          |
| `OpenusdCppBackend`                            | 手書き（既存写経） | ~300          |
| 共通化する純粋ロジック抽出                     | リファクタ         | ~100 差分     |
| **合計**                                       |                    | **~1120 LOC** |

## スコープ外（明示）

- macOS x86_64（Intel Mac）と Linux
- macOS 正式 codesign / notarization（ad-hoc signing で PoC 合格を先に取る）
- geometry / material / skel の C++ 経由実装（次フェーズ）
- Hydra レンダリングの取り込み（ずっと先）
- Python support / usdview / imaging（vcpkg port のデフォルト feature で十分）
- `requires_glb_preview` / `extract_geometry_glb` の新 backend 実装
- upstream OpenUSD への C API 提案（今回はローカル shim に閉じる）
- vcpkg 以外の依存管理（Conan / Homebrew / 手動 build_usd.py）— exit rule 発動時のみ検討
