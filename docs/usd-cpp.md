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

### 3. baseline commit SHA を `vcpkg.json` に書き込む

`src-tauri/vcpkg.json` と `src-tauri/vcpkg-configuration.json` の
`REPLACE_WITH_VCPKG_COMMIT_SHA` を、使いたい vcpkg の commit SHA で置換する。

```sh
cd ~/.vcpkg
git rev-parse HEAD              # ← この SHA をコピー
```

その SHA を両ファイルに貼る。開発者間と CI で同じ SHA を使うことで、
「全員が同じ OpenUSD 版」が強制される。

推奨は **`usd` port の v25.5.1 が入っている直近の vcpkg commit**（v25.2 に
Python リンクの既知問題がある版は避ける）。

### 4. ビルド前提ツール

| OS      | 必要なもの                                                                                 |
| ------- | ------------------------------------------------------------------------------------------ |
| Windows | Visual Studio 2022（Desktop C++ workload）、CMake 3.22+、Python 3.11+（vcpkg port が使う） |
| macOS   | Xcode 15+（command line tools）、CMake 3.22+、Python 3.11+                                 |

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

MSI の中身は 7zip で確認可能。以下 3 つの DLL が `resources/` 配下にあれば OK:
`usd_ms.dll` / `tbb12.dll` / `usd_c_shim.dll`。

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
4. 必要なら `usd` の `version>=` も更新（vcpkg registry にある範囲で）
5. `cargo build --features backend-openusd-cpp` — 変更された依存だけ再ビルド
6. Kitchen Set / tiny.usda / USDZ の inspector 出力が回帰していないか確認してから commit

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
