# USD C++ ラッパー PoC（Option C / Inspector only）

## Context

yw-look は現在 USD パースを `yohawing/openusd` fork（pure Rust, `rev = 0419da04…`）に依存している。
docs/usd.md Phase 0〜5 で積み上げてきた資産だが、以下が中長期の懸念になっている:

- fork 側で手書きしてきた composition / xformOp / variant 対応が upstream 互換から離れやすい
- USDC 復号や MaterialX / Hydra 準拠の更新を自前で追う必要がある
- fork の PR merge 進行に依存した運用が固定化している

**目的**: Pixar 公式 OpenUSD C++ を境界を狭く切った C shim 経由で呼び、`UsdBackend` 実装を 1 つ増やすことで fork 依存を段階的に剥がせる状態にする。
今回のゴールは PoC：Windows MSVC で公式 USD を実運用に載せられるかの地雷（ビルド・配布・起動時間・ランタイム依存）を踏み切るところまで。

## アプローチ（Option C）

公式 OpenUSD を 1 回だけ monolithic prebuild → 手書き C shim 経由で Rust から bindgen で叩く。
`UsdBackend` trait の後ろに 2 つ目の実装 `OpenusdCppBackend` を追加し、Cargo feature で切替。

```
openusd (pure Rust fork)  ──┐
                            ├── UsdBackend ── Tauri commands ── frontend
usd_c_shim (C API)          │
 → libusd_ms.dll (prebuild)─┘    ↑ feature = "backend-openusd-cpp" で差替
```

### PoC で実装する UsdBackend メソッド

| メソッド | 実装 |
|---|---|
| `inspect_stage` | ✅ C shim 経由で実装 |
| `summarize_stage` | ✅ C shim 経由で実装 |
| `collect_asset_issues` | ✅ C shim 経由で実装 |
| `root_layer_is_binary` | ✅ 診断用、薄い |
| `requires_glb_preview` | ⏸ 常に `false` を返す or Rust backend にフォールバック（PoC 範囲外） |
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
├── build.rs                                # DLL リンク / コピー
├── src/
│   └── usd/
│       ├── backend.rs                      # 変更なし（trait は既に抽象化済み）
│       ├── openusd_backend.rs              # 既存（default feature）
│       ├── openusd_cpp_backend.rs          # NEW: C shim を叩く実装
│       ├── cpp_sys/
│       │   ├── mod.rs                      # NEW: bindgen エントリ + 安全ラッパ
│       │   └── wrapper.h                   # NEW: shim ヘッダの include 口
│       └── mod.rs                          # feature に応じて backend を差替
├── third_party/
│   └── usd_c_shim/                         # NEW: 自前 C++ shim のソース
│       ├── CMakeLists.txt
│       ├── include/usd_c_shim.h            # opaque handle + flat C functions
│       └── src/usd_c_shim.cpp              # UsdStage / traverse / field 読みの薄い移植
└── vendor/
    └── openusd/
        ├── windows-x64/                    # LFS tracked
        │   ├── bin/usd_ms.dll
        │   ├── bin/tbb12.dll
        │   ├── bin/usd_c_shim.dll
        │   ├── lib/usd_c_shim.lib
        │   ├── include/ (OpenUSD + shim 公開 header 抜粋)
        │   └── BUILD_INFO.md
        └── macos-arm64/                    # LFS tracked
            ├── lib/libusd_ms.dylib
            ├── lib/libtbb.12.dylib
            ├── lib/libusd_c_shim.dylib
            ├── include/ (共通 header 抜粋)
            └── BUILD_INFO.md

tauri.conf.json                             # bundle.resources に各 OS の shared lib を条件付きで追加
.gitattributes                              # vendor/openusd/**/*.{dll,dylib,lib} を LFS に
docs/usd-cpp.md                             # NEW: ビルド手順・更新手順・PoC 結果
```

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
   int         usdc_prim_has_variants(UsdcStage*, const char* prim_path);
   int         usdc_prim_type_is_mesh(UsdcStage*, const char* prim_path);
   ```
   Inspector に必要な読み取り系のみ。返す文字列は shim 内部の `thread_local std::string` or 呼び出し側が C 文字列を安全にコピーする運用。
3. `src/usd_c_shim.cpp` で `pxr::UsdStage::Open` を呼び、`PrimRange` / `UsdPrim::GetReferences` / `UsdPayloads` / `GetVariantSets` を薄くラップ。例外は `catch(...)` で `UsdcError` に詰めて返す（FFI 境界で例外を漏らさない）。
4. CMake で OpenUSD を `find_package(pxr CONFIG)` で引く。monolithic prebuild の install prefix をユーザー環境変数 `OPENUSD_ROOT` で受ける。出力は `usd_c_shim.dll`。

### Step 2: OpenUSD 公式を 1 回プリビルド → vendor に配置

OpenUSD `v25.05a`（最新 stable）を clone し、`build_scripts/build_usd.py` で以下共通フラグでビルドする:
- `--build-monolithic`
- `--no-python`
- `--no-imaging --no-usdview --no-tests --no-examples --no-tutorials --no-docs`
- `--build-variant release`

#### Windows x64

- `--generator "Visual Studio 17 2022"`
- `--build-args cmake,"-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL"`
- 出力: `bin/usd_ms.dll` + `tbb12.dll` → `src-tauri/vendor/openusd/windows-x64/bin/`
- shim を同じ MSVC でビルド → `usd_c_shim.dll` / `.lib`

#### macOS arm64

- `--build-args cmake,"-DCMAKE_OSX_ARCHITECTURES=arm64" cmake,"-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0"`
- 出力: `lib/libusd_ms.dylib` + `libtbb.12.dylib` → `src-tauri/vendor/openusd/macos-arm64/lib/`
- shim は clang でビルド → `libusd_c_shim.dylib`
- **install_name / rpath**: `install_name_tool -id @rpath/libusd_ms.dylib ...` と `@rpath/libtbb.12.dylib` に正規化。shim には `-Wl,-rpath,@loader_path` を付けて隣接 dylib を解決させる。Tauri `.app` バンドル内で `Contents/Frameworks/` に置く運用
- **Ad-hoc codesign**: `codesign --force --sign - libusd_ms.dylib` を全 dylib に適用（Gatekeeper の "unidentified developer" 回避の最低線。正式署名は後続）

両 OS 共通:
- 各 OS ツリーに `BUILD_INFO.md`（OpenUSD tag / CMake フラグ / TBB version / ビルド日 / ビルドマシン）を記録
- `.gitattributes` に以下を追加し LFS track:
  ```
  src-tauri/vendor/openusd/**/*.dll  filter=lfs diff=lfs merge=lfs -text
  src-tauri/vendor/openusd/**/*.lib  filter=lfs diff=lfs merge=lfs -text
  src-tauri/vendor/openusd/**/*.dylib filter=lfs diff=lfs merge=lfs -text
  ```

### Step 3: Rust 側 FFI（`cpp_sys` モジュール）

1. `Cargo.toml` に新 feature:
   ```toml
   [features]
   default = ["backend-openusd-rs"]
   backend-openusd-rs = []
   backend-openusd-cpp = ["dep:bindgen"]
   ```
   openusd crate 依存は `backend-openusd-rs` feature に紐づけ、両立不可 feature として `compile_error!` ガード。
2. `src-tauri/build.rs` で feature 時のみ、ターゲット OS に応じて vendor tree を選択:
   ```rust
   let vendor = match env::var("CARGO_CFG_TARGET_OS").unwrap().as_str() {
       "windows" => "vendor/openusd/windows-x64",
       "macos"   => "vendor/openusd/macos-arm64",
       other => panic!("backend-openusd-cpp: unsupported target os {other}"),
   };
   ```
   - `bindgen` で `{vendor}/include/usd_c_shim.h` → `OUT_DIR/usd_c_shim_bindings.rs`
   - Windows: `cargo:rustc-link-search=native={vendor}/lib` + `cargo:rustc-link-lib=dylib=usd_c_shim`
   - macOS: `cargo:rustc-link-search=native={vendor}/lib` + `cargo:rustc-link-lib=dylib=usd_c_shim` + `cargo:rustc-link-arg=-Wl,-rpath,@loader_path/../Frameworks`
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

Tauri は platform 別 resource 指定に対応していないため、ビルド時に CI スクリプト or `build.rs` が `tauri.conf.json` の `bundle.resources` を書き換える運用にする。PoC 中は OS ごとに手動で `tauri.conf.<os>.json` を用意し、`tauri build --config` で切替:

`tauri.windows.json`:
```json
"bundle": {
  "resources": [
    "vendor/openusd/windows-x64/bin/usd_ms.dll",
    "vendor/openusd/windows-x64/bin/tbb12.dll",
    "vendor/openusd/windows-x64/bin/usd_c_shim.dll"
  ]
}
```

`tauri.macos.json`:
```json
"bundle": {
  "resources": [
    "vendor/openusd/macos-arm64/lib/libusd_ms.dylib",
    "vendor/openusd/macos-arm64/lib/libtbb.12.dylib",
    "vendor/openusd/macos-arm64/lib/libusd_c_shim.dylib"
  ],
  "macOS": {
    "frameworks": [
      "vendor/openusd/macos-arm64/lib/libusd_ms.dylib",
      "vendor/openusd/macos-arm64/lib/libtbb.12.dylib",
      "vendor/openusd/macos-arm64/lib/libusd_c_shim.dylib"
    ]
  }
}
```

macOS は `frameworks` に入れることで `.app/Contents/Frameworks/` に配置され、Step 3 で設定した `@loader_path/../Frameworks` rpath から解決される。feature OFF ビルドでは resources に含まれないよう、配布 CI で feature と config を同時に切替。PoC 中は手動で OK。

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
cd src-tauri && cargo build --no-default-features --features backend-openusd-cpp

# Tauri app 実配布形態
npm run tauri build -- --config src-tauri/tauri.windows.json   # Windows
npm run tauri build -- --config src-tauri/tauri.macos.json     # macOS
```

macOS ビルド時は `.app/Contents/Frameworks/` に 3 本の dylib が含まれ、`otool -L .../Contents/MacOS/yw-look` で `@rpath/libusd_c_shim.dylib` が解決することを確認する。

### 機能検証（Phase 0 と同じアセット）

`experiments/usd-cpp-poc/` か、`cargo test --features backend-openusd-cpp` で以下を比較:

| アセット | `Stage::open` | `default_prim` | `layer_count` | `root_prims` | traverse prim 数 |
|---|---|---|---|---|---|
| `samples/assets/usd/tiny.usda` | ✅ | `"Root"` | 1 | 1 | 2 |
| `Kitchen_set.usd` | ✅ | `"Kitchen_set"` | 229 | 77 | 2048 |
| `Kitchen_set_instanced.usd` | **要確認**（Rust fork では USDA parser が instanceable を落として失敗していた。C++ なら通る想定） | — | — | — | — |
| `chameleon_anim_mtl_variant.usdz` | ✅ | `"Root"` | 1 | 1 | 203 |
| `glove_baseball_mtl_variant.usdz` | ✅ | `"glove_baseball"` | 1 | 1 | 67 |

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
3. C shim でクラッシュが 1 アセット / 1000 file open 以上の頻度
4. MSI ビルドに 3 分以上加算される（開発 DX が顕著に劣化）

撤退時の成果物は docs/usd-cpp.md に「なぜ止めたか」を残し、vendor ツリーと shim ソースは削除する。

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

### 2 層目: `src-tauri/build.rs`（bindgen 自動生成）

```rust
fn main() {
    tauri_build::build();
    #[cfg(feature = "backend-openusd-cpp")]
    build_cpp_backend();
}

#[cfg(feature = "backend-openusd-cpp")]
fn build_cpp_backend() {
    use std::{env, path::PathBuf};

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let vendor = match target_os.as_str() {
        "windows" => "vendor/openusd/windows-x64",
        "macos"   => "vendor/openusd/macos-arm64",
        other => panic!("backend-openusd-cpp: unsupported target os {other}"),
    };

    let header = format!("{vendor}/include/usd_c_shim.h");
    println!("cargo:rerun-if-changed={header}");

    let bindings = bindgen::Builder::default()
        .header(&header)
        .allowlist_function("usdc_.*")
        .allowlist_type("Usdc.*")
        .prepend_enum_name(false)
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect("bindgen failed");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("usd_c_shim_bindings.rs");
    bindings.write_to_file(&out).unwrap();

    println!("cargo:rustc-link-search=native={vendor}/lib");
    println!("cargo:rustc-link-lib=dylib=usd_c_shim");
    if target_os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path/../Frameworks");
    }
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

| 層 | 書き方 | LOC |
|---|---|---|
| C++ → C shim header | 手書き | ~80 |
| C++ → C shim 実装 | 手書き | ~300 |
| CMakeLists.txt | 手書き | ~30 |
| build.rs（bindgen driver） | 手書き | ~40 |
| bindgen 生成バインディング | 自動 | 0（OUT_DIR） |
| 安全 Rust ラッパ（`cpp_sys/mod.rs`） | 手書き | ~200 |
| `OpenusdCppBackend` | 手書き（既存写経） | ~300 |
| 共通化する純粋ロジック抽出 | リファクタ | ~100 差分 |
| **合計** | | **~1050 LOC** |

## スコープ外（明示）

- macOS x86_64（Intel Mac）と Linux
- macOS 正式 codesign / notarization（ad-hoc signing で PoC 合格を先に取る）
- geometry / material / skel の C++ 経由実装（次フェーズ）
- Hydra レンダリングの取り込み（ずっと先）
- Python support / usdview / imaging
- `requires_glb_preview` / `extract_geometry_glb` の新 backend 実装
- upstream OpenUSD への C API 提案（今回はローカル shim に閉じる）
