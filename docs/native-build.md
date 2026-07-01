# Native Build Notes

`yw-look` の C++ native component を触る前に読む短い運用メモ。
OpenUSD C++ backend の詳細は [`docs/usd-cpp.md`](./usd-cpp.md) を正とする。

## 対象

- OpenUSD C++ backend
  - `src-tauri/build.rs`
  - `src-tauri/third_party/usd_c_shim/`
  - `src-tauri/third_party/prebuilt/openusd/`
  - `src-tauri/vcpkg.json` / `src-tauri/vcpkg-configuration.json`
- Alembic preview helper
  - `src-tauri/alembic-tools/src/abc_to_obj.cpp`
  - `src-tauri/alembic-tools/<platform>/abc_to_obj*`

## 通常ビルド

通常は OpenUSD prebuilt payload と同梱済み Alembic helper を使う。
vcpkg source build は走らない。

```powershell
cd src-tauri
cargo build
```

## vcpkg / toolchain が必要な場合

次の場合だけ vcpkg と C++ toolchain を用意する。

- OpenUSD prebuilt payload がない platform / triplet を試す
- OpenUSD prebuilt payload を再生成する
- `src-tauri/alembic-tools/src/abc_to_obj.cpp` を変更して helper binary を再生成する

前提:

- `VCPKG_ROOT` は vcpkg checkout を指す。推奨は `~/.vcpkg`
- Windows: Visual Studio 2022 Desktop C++ workload、CMake 3.22+、Python 3.11+、LLVM 18+
- macOS: Xcode command line tools、CMake 3.22+、Python 3.11+、LLVM 18+
- bindgen 用に `LIBCLANG_PATH` を設定する

詳細セットアップは [`docs/usd-cpp.md`](./usd-cpp.md) の「初回セットアップ」を参照。

## 強制再ビルド

OpenUSD を prebuilt ではなく vcpkg 経路で確認・再生成する場合:

```powershell
cd src-tauri
$env:OPENUSD_FORCE_VCPKG = "1"
cargo build
```

Alembic preview helper をソースから再生成する場合:

```powershell
cd src-tauri
$env:ALEMBIC_FORCE_BUILD = "1"
cargo build
```

## Commit ルール

- `abc_to_obj.cpp` を編集しただけでは helper binary は更新されない。変更後は `ALEMBIC_FORCE_BUILD=1` で再ビルドし、更新された `abc_to_obj.exe` または `abc_to_obj` も commit する。
- OpenUSD prebuilt payload を更新する場合は、[`docs/usd-cpp.md`](./usd-cpp.md) の payload 更新手順と license notice 更新手順に従う。
- `src-tauri/vcpkg_installed/` や `src-tauri/target/` は commit しない。
- 成果物だけでなく、再現可能な設定・manifest・手順が追える状態にする。
