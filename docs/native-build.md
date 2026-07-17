# Native Build Notes

`yw-look` の通常の USD 処理は pure Rust backend だけで完結する。C++ が必要なのは、
同梱済みの Alembic preview helper をソースから再生成するときだけである。

## 通常ビルド

通常は同梱済み helper をそのまま使うため、CMake / vcpkg / C++ toolchain は不要。

```powershell
cd src-tauri
cargo build
```

## Alembic helper の再生成

次の場合だけ vcpkg と C++ toolchain を用意する。

- `src-tauri/alembic-tools/src/abc_to_obj.cpp` を変更した
- 同梱 helper を更新したい
- `ALEMBIC_FORCE_BUILD=1` で明示的に再生成する

前提:

- `VCPKG_ROOT` は vcpkg checkout を指す（推奨は `~/.vcpkg`）
- Windows: Visual Studio 2022 Desktop C++ workload、CMake 3.22+、Ninja
- macOS: Xcode command line tools、clang++、CMake 3.22+

```powershell
$env:ALEMBIC_FORCE_BUILD = "1"
cd src-tauri
cargo build
```

build.rs は `src-tauri/vcpkg.json` の Alembic 依存だけを使って helper を再生成し、
`src-tauri/alembic-tools/<triplet>/` に配置する。通常の Rust build ではこの処理は
同梱 helper の存在確認だけで終わる。

## Commit ルール

- `abc_to_obj.cpp` を編集しただけでは helper binary は更新されない。変更後は
  `ALEMBIC_FORCE_BUILD=1 cargo build` を実行し、更新された helper と再現可能な設定を
  同じ変更として扱う。
- `src-tauri/vcpkg_installed/` や `src-tauri/target/` は commit しない。
