# USD C++ バックエンド — 手順書

yw-look の USD パースを Pixar OpenUSD C++ 経由で行うための手順書。
計画は [docs/usd-cpp-poc.md](./usd-cpp-poc.md) を参照。

---

## 位置づけ

- **default** は `backend-openusd-rs` feature（`yohawing/openusd` fork、pure Rust）
- **`backend-openusd-cpp`** feature を付けたときのみ Pixar OpenUSD C++ に切り替わる
- 対応プラットフォーム: **Windows MSVC x64** / **macOS arm64** のみ
- PoC スコープ: **Inspector API のみ**
  - `inspect_stage` / `summarize_stage` / `collect_asset_issues` / `root_layer_is_binary`
  - `requires_glb_preview` は常に `false`、`extract_geometry_glb` は明示エラー
  - 3D 描画経路は引き続き Rust fork（default feature）を使う

## 仕組み

```
┌─────────────────────────────────┐
│ Tauri frontend                  │
└──────────────┬──────────────────┘
               │ invoke('inspect_stage', ...)
┌──────────────▼──────────────────┐
│ lib.rs                          │
│   UsdBackendState(DefaultBackend)
└──────────────┬──────────────────┘
               │ UsdBackend trait
┌──────────────▼──────────────────┐
│ OpenusdCppBackend  (this doc)   │
│   src/usd/openusd_cpp_backend.rs│
└──────────────┬──────────────────┘
               │ CStage (safe Rust wrapper)
┌──────────────▼──────────────────┐
│ src/usd/cpp_sys/mod.rs          │  ← bindgen 生成 + RAII
└──────────────┬──────────────────┘
               │ extern "C" UsdcStage*
┌──────────────▼──────────────────┐
│ usd_c_shim (C++ static-hidden)  │  ← third_party/usd_c_shim/
│   opaque handle + callback      │
└──────────────┬──────────────────┘
               │ pxr::UsdStage
┌──────────────▼──────────────────┐
│ Pixar OpenUSD  (via vcpkg)      │
│   vcpkg_installed/<triplet>/    │
└─────────────────────────────────┘
```

C++ は一切 Rust 側に漏れない：C ABI の境界で例外を `UsdcError` に詰め替え、opaque
handle で pxr 型を隠す。bindgen は C ヘッダしか見ない。

## 初回セットアップ

### 1. vcpkg を clone

```sh
# 任意のパス。~/.vcpkg を推奨
git clone https://github.com/microsoft/vcpkg ~/.vcpkg
~/.vcpkg/bootstrap-vcpkg.sh            # macOS / Linux
# ~/.vcpkg/bootstrap-vcpkg.bat         # Windows PowerShell / cmd
```

### 2. `VCPKG_ROOT` を export

```sh
# bash / zsh
export VCPKG_ROOT="$HOME/.vcpkg"
```

```powershell
# PowerShell
setx VCPKG_ROOT "$env:USERPROFILE\.vcpkg"
# 新しいターミナルで有効化
```

### 3. baseline commit SHA（すでに pin 済み）

`src-tauri/vcpkg.json` と `src-tauri/vcpkg-configuration.json` の
`builtin-baseline` / `default-registry.baseline` はリポジトリで既に固定済み
（`b83a1344…`, usd port v26.3）。**通常セットアップでは触らなくてよい**。

あえて上げたいときは、[vcpkg を最新化したいとき](#vcpkg-を最新化したいとき)
を参照。なお vcpkg registry の version 表記は zero-pad なしの `25.5.1` 形式
（`25.05.1` は別文字列で resolve に失敗する）なので、`version>=` を直接編集する
場合はそのままの綴りを使う。

### 4. ビルド前提ツール

| OS      | 必要なもの                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------- |
| Windows | Visual Studio 2022（Desktop C++ workload）、CMake 3.22+、Python 3.11+（vcpkg port が使う）、**LLVM 18+**（bindgen） |
| macOS   | Xcode 15+（command line tools）、CMake 3.22+、Python 3.11+、**LLVM 18+**（bindgen、`brew install llvm`）            |

**LLVM は必須**。`build.rs` で bindgen が C ヘッダを解析する際に `libclang.dll`
/ `libclang.dylib` を要求する。未導入なら:

```powershell
# Windows
winget install LLVM.LLVM
setx LIBCLANG_PATH "C:\Program Files\LLVM\bin"
# 新しいターミナルで有効化
```

```sh
# macOS
brew install llvm
export LIBCLANG_PATH="$(brew --prefix llvm)/lib"
# shell rc に追記して永続化
```

Visual Studio 2022 / 2026 に同梱の `clang-format` / `clang-tidy` には
`libclang.dll` が含まれないので、別途スタンドアロンの LLVM を入れる必要がある。

### 5. 初回ビルド

```sh
cd yw-look/src-tauri

# C++ feature OFF（default）。従来どおり。
cargo build

# C++ feature ON。初回は vcpkg が OpenUSD を source build するため 30〜60 分かかる。
cargo build --no-default-features --features backend-openusd-cpp
```

2 回目以降は vcpkg の binary cache から秒で復元される。vcpkg.json / baseline SHA を
書き換えたときだけ再ビルドが走る。

## 配布ビルド

### Windows

```powershell
cd yw-look
npm run tauri build -- `
  --no-default-features `
  --features "yw_look_lib/backend-openusd-cpp" `
  --config src-tauri/tauri.windows.json
```

生成物: `src-tauri/target/release/bundle/msi/*.msi`

MSI の中身は 7zip で確認可能。`resources/` 配下に以下が揃っていれば OK:

- `usd_c_shim.dll` — yw-look の C shim
- `usd_*.dll`（`usd_usd.dll`, `usd_sdf.dll`, `usd_tf.dll`, `usd_usdGeom.dll`,
  `usd_usdShade.dll`, … 数十本）— OpenUSD 26.3 の split 本体
- `tbb12.dll` / `tbbmalloc.dll` / `hwloc-15.dll` / `zlib1.dll` — transitive 依存
- `usd/<name>/resources/plugInfo.json` ツリー — 起動時の plugin registry bootstrap 用

**注意**: OpenUSD 26.3 の vcpkg port は monolithic `usd_ms.dll` を吐かない。
シンボルは `usd_*.dll` に分散される。`build.rs` は `vcpkg_installed/<triplet>/
bin/` 配下の `usd_*.dll` をすべて prefix マッチで拾うので、port の flavor 変更
（monolithic / split 切替）に追随して動くが、古いドキュメントが `usd_ms.dll`
単独を期待していた場合は読み替えが必要。

### macOS arm64

```sh
cd yw-look
npm run tauri build -- \
  --no-default-features \
  --features "yw_look_lib/backend-openusd-cpp" \
  --config src-tauri/tauri.macos.json
```

生成物: `src-tauri/target/release/bundle/macos/yw-look.app` と `.dmg`。

検証:

```sh
# dylib が Frameworks に配置されているか
ls yw-look.app/Contents/Frameworks/
# libusd_ms.dylib / libtbb.12.dylib / libusd_c_shim.dylib があればよい

# メインバイナリが rpath 経由で shim を解決できるか
otool -L yw-look.app/Contents/MacOS/yw-look
# @rpath/libusd_c_shim.dylib が出れば OK

# ad-hoc codesign の確認
codesign --verify --deep --strict --verbose=4 yw-look.app
```

## vcpkg を最新化したいとき

1. `cd ~/.vcpkg && git pull`
2. `git rev-parse HEAD` で新しい SHA を取得
3. `src-tauri/vcpkg.json` と `src-tauri/vcpkg-configuration.json` の baseline を差替
4. 必要なら `usd` の `version>=` も更新（vcpkg registry にある範囲で）。表記は
   zero-pad なし（`25.5.1`、`26.3`）。
5. `cargo build --features backend-openusd-cpp` — 変更された依存だけ再ビルド
6. Kitchen Set / tiny.usda / USDZ の inspector 出力が回帰していないか確認してから commit

## 実機セットアップで踏みやすい地雷

初回ビルドで頻出した失敗モードと回避策。新しい開発マシンで詰まったら読む。

### A. `VCPKG_ROOT is not set. See docs/usd-cpp.md for setup.`

初回セットアップ手順 1-2 で vcpkg を clone + `VCPKG_ROOT` を export し忘れ。
`setx` 後は **新しいターミナルを開き直す** 必要がある点に注意。

### B. `Unable to find libclang: ...`

bindgen が使う `libclang.dll` が無い。初回セットアップ手順 4 で LLVM を
入れて `LIBCLANG_PATH` を通す。Visual Studio の `clang-format` / `clang-tidy`
に含まれる LLVM は `libclang.dll` を同梱していないので、**スタンドアロンの
LLVM を別途入れる**必要がある。

### C. `error: no version database entry for usd at 25.05.1`

`vcpkg.json` の `version>=` 表記ミス。vcpkg registry は `25.5.1`（zero-pad
なし）で登録しているので、`25.05.1` は別文字列扱いになり resolve に失敗する。

### D. `pxrInternal_v0_26_X__pxrReserved__::pxrInternal_v0_26_X__pxrReserved__::...` 系の構文エラー

`PXR_NAMESPACE_OPEN_SCOPE` が **2 回展開されて namespace が二重ネスト**する
症状。原因は CMake の `find_package(pxr)` が vcpkg ではなく**ローカルに別途
ビルドした OpenUSD**（例: `D:\OpenUSD\build\`）を拾ってしまっている。
CMake の user package registry（`%USERPROFILE%\.cmake\packages\pxr\`）経由で
勝手に登録されているケースが多い。

現在の `build.rs` は `-Dpxr_DIR=<vcpkg_installed>/share/pxr` を渡して
vcpkg のコピーを強制採用するので、env var や user package registry に
ローカル OpenUSD が居残っていても問題にならない。**何もしなくてよい**。

もし再発したら:

1. キャッシュ残存: `rm -r target/debug/build/yw-look-*/out/build` で CMake
   キャッシュを消してから再ビルド。
2. 追加の CMake 変数で pxr を参照しているケース（考えにくい）:
   `Get-ChildItem Env: | Where-Object Name -match "pxr|PXR|OpenUSD|CMAKE_PREFIX"`
   で残存 env を点検。

### E. `Could not find a package configuration file provided by "TBB"`

vcpkg toolchain が install tree を見つけられていない。`build.rs` が
`-DVCPKG_INSTALLED_DIR=<manifest_dir>/vcpkg_installed` を渡していなかった
旧版で発生した。現在は修正済み。

### F. `(exit code: 0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND)`

shim は load できたがその先の `usd_*.dll` / `tbb12.dll` / `hwloc-15.dll` 等が
見つからない、または必要なシンボルがない。原因はたいてい:

- `build.rs` の DLL staging リストが port の flavor 変更に追随していない
  （過去: monolithic `usd_ms.dll` だけ staging、split flavor の `usd_*.dll` は
  スキップ）。現在の `build.rs` は prefix (`usd_*`, `tbb*`, `hwloc*`, `zlib1`)
  でスキャンするので、port が split / monolithic を切替えても追随する。
- `PATH` にローカルビルド OpenUSD（`D:\OpenUSD\bin` など）が混入していて、
  shim から import される `usd_*.dll` がそちらに解決される。Windows の DLL
  検索順序では EXE の同じディレクトリが最優先なので、`build.rs` が
  `target/<profile>/` と `target/<profile>/deps/` 両方に vcpkg 版をコピー
  する現設計なら勝てる。それでも事故ったら PATH から OpenUSD を一時的に外す。

### G. `(exit code: 0x80000003)` / OpenUSD の plugin 関連 abort

`UsdStage::Open` が `.usda` / `.usdc` の file-format plugin を見つけられず
fatal abort。`PlugRegistry` にプラグインが登録されていないときの症状。

vcpkg は `bin/usd/<name>/resources/plugInfo.json` を個別に置くが、**それらを
束ねる top-level manifest (`bin/usd/plugInfo.json`) を置かない**。
vcpkg 自身は `lib/usd/plugInfo.json` と `plugin/usd/plugInfo.json` に
`{"Includes": ["*/resources/"]}` という小さなマニフェストを置いているが、
shim 側が `bin/` 隣接でしか探さない限りそれは見えない。

現在の `build.rs` は mirror 先ディレクトリにこのマニフェストを `fs::write` で
生成する。加えて shim 側 `register_plugins_once()` が自 DLL の位置を
`GetModuleHandleExA + GetModuleFileNameA`（POSIX は `dladdr`）で特定して、
`<dll_dir>/usd` を `PlugRegistry::RegisterPlugins` に渡す。ここが動いて
いれば起動時の plugin load は通る。

デバッグしたい場合:

```powershell
$env:TF_DEBUG = "PLUG_INFO_SEARCH PLUG_LOAD"
cargo test --no-default-features --features backend-openusd-cpp `
  --test cpp_backend_inspector -- --nocapture
```

`Did check plugin info paths in ...` / `Will read plugin info ...` という
行が OpenUSD 側から出る。`plugInfo.json` が読めなかった旨のログが
top-level manifest 欠落のサイン。

## CI

GitHub Actions に Windows / macOS ジョブを足し、vcpkg binary cache を Actions
Cache に接続して初回の 30〜60 分を償却する。

```yaml
# .github/workflows/ci.yml（抜粋）
jobs:
  build-cpp-windows:
    runs-on: windows-latest
    env:
      VCPKG_ROOT: ${{ github.workspace }}/vcpkg
      VCPKG_BINARY_SOURCES: "clear;x-gha,readwrite"
    steps:
      - uses: actions/checkout@v4
      - name: Bootstrap vcpkg
        run: |
          git clone https://github.com/microsoft/vcpkg $env:VCPKG_ROOT
          & $env:VCPKG_ROOT/bootstrap-vcpkg.bat
      - uses: dtolnay/rust-toolchain@stable
      - name: Build (C++ backend)
        working-directory: src-tauri
        run: cargo build --no-default-features --features backend-openusd-cpp

  build-cpp-macos:
    runs-on: macos-14 # arm64 runner
    env:
      VCPKG_ROOT: ${{ github.workspace }}/vcpkg
      VCPKG_BINARY_SOURCES: "clear;x-gha,readwrite"
    steps:
      - uses: actions/checkout@v4
      - name: Bootstrap vcpkg
        run: |
          git clone https://github.com/microsoft/vcpkg "$VCPKG_ROOT"
          "$VCPKG_ROOT/bootstrap-vcpkg.sh"
      - uses: dtolnay/rust-toolchain@stable
      - name: Build (C++ backend)
        working-directory: src-tauri
        run: cargo build --no-default-features --features backend-openusd-cpp
```

初回 run で OpenUSD がフルビルドされキャッシュに保存される（~1 GB）。以降は
数十秒で復元される。

## 成果物のパス

| 成果物                       | 生成元                        | 配置先                                                         |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------- |
| OpenUSD の .dll / .dylib     | vcpkg                         | `src-tauri/vcpkg_installed/<triplet>/{bin,lib}/`               |
| shim の .dll / .dylib        | build.rs の cmake crate       | `src-tauri/target/.../cmake/` 経由 → `cpp-artifacts/` にコピー |
| Tauri bundler が読む staging | build.rs の post-build コピー | `src-tauri/cpp-artifacts/<triplet>/`                           |
| 最終配布物（MSI / .app）     | `tauri build`                 | `src-tauri/target/release/bundle/`                             |

`cpp-artifacts/` と `vcpkg_installed/` は `.gitignore`。成果物は git で管理しない。

## ライセンス（MSI / .app 同梱時）

vcpkg 経由でビルドした OpenUSD + 依存は、配布物（MSI / .app）に同梱される時点で
**再配布行為**になる。以下を配布物の about 画面または `Resources/licenses/`（同梱
ファイル）に含める必要がある:

| ライブラリ                               | ライセンス                                                      | 必要な表示                                 |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| OpenUSD                                  | Tomorrow Open Source Technology License 1.0 (Apache 2.0 改変版) | LICENSE.txt と NOTICE.txt を同梱           |
| oneTBB                                   | Apache 2.0                                                      | LICENSE.txt と third-party-programs を同梱 |
| Boost（一部モジュールで使用）            | Boost Software License 1.0                                      | LICENSE.txt を同梱                         |
| MaterialX（vcpkg port が有効化した場合） | Apache 2.0                                                      | LICENSE.txt を同梱                         |

依存ツリーは以下で取得:

```sh
$VCPKG_ROOT/vcpkg depend-info usd --triplet=x64-windows
```

出力されたリストのうち実際にリンクされているもの分だけライセンスを集めればよい。

## Exit rule / 撤退

以下のいずれかに該当したら C++ バックエンドは廃止し、`backend-openusd-rs` 単独運用に戻す:

- `usd_ms.dll` + 依存の合計が 150 MB を超える
- クリーン Windows 環境で起動できない（C++ ランタイム / side-by-side エラー）
- クリーン macOS 環境で起動できない（codesign / rpath / quarantine）
- C shim でクラッシュが 1 アセット / 1000 file open 以上
- vcpkg の `usd` port が壊れ、fix が 3 ヶ月以上来ない
- MSI / .app ビルド（CI の cache hit 時）に 3 分以上加算

撤退手順:

1. `Cargo.toml` から `backend-openusd-cpp` feature と optional deps を削除
2. `src-tauri/src/usd/cpp_sys/` / `openusd_cpp_backend.rs` を削除
3. `src-tauri/third_party/usd_c_shim/` / `vcpkg.json` / `vcpkg-configuration.json` を削除
4. `tauri.windows.json` / `tauri.macos.json` を削除
5. `docs/usd-cpp-poc.md` に「なぜ止めたか」の最終節を追記して保存（歴史資料として残す）

撤退後も計画書は履歴に残す — 同じ判断を後で再検討するときの材料になる。
