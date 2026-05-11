# License Notes

yw-look のリポジトリで管理しているソースコードは MIT License とする。

依存ライブラリ、ビルドツール、OS / SDK コンポーネントにはそれぞれのライセンスが適用される。このファイルは、MIT 追加時点の依存ライセンス確認メモであり、配布物に同梱する第三者ライセンス表の完全な代替ではない。

## Project License

- Project source: MIT License
- License file: `LICENSE`
- Package metadata: `package.json` の `license` は `MIT`

## Dependency Scan

2026-05-07 時点で、以下のローカル情報から確認した。

```powershell
node -e "<package-lock.json license summary>"
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --locked
```

### npm dependencies

`package-lock.json` 上の依存に `UNKNOWN` license はない。

主な license:

- MIT
- Apache-2.0
- Apache-2.0 OR MIT
- BSD-2-Clause / BSD-3-Clause
- ISC
- MIT-0
- CC0-1.0

注意して表示対象に含めるもの:

- `argparse`: Python-2.0
- `caniuse-lite`: CC-BY-4.0
- `@typescript-eslint/typescript-estree/node_modules/minimatch`: BlueOak-1.0.0
- `jsdom/node_modules/lru-cache`: BlueOak-1.0.0

### Cargo dependencies

`cargo metadata` 上の依存は大半が MIT / Apache-2.0 / BSD / ISC / Zlib / Unicode 系の permissive license。

注意して表示対象に含めるもの:

- `openusd` crate: `license_file = "LICENSE"`。確認時点の license file は MIT License。
- `webpki-root-certs`: CDLA-Permissive-2.0
- MPL-2.0 の crate が含まれる。MPL はファイル単位の weak copyleft なので、配布時は license notice と該当コンポーネントの扱いを確認する。
- `MIT OR Apache-2.0 OR LGPL-2.1-or-later` のような複数選択 license は、通常は permissive 側を選べるが、配布物作成時に最終的な notice に反映する。

## Distribution Notes

- このリポジトリの `LICENSE` は yw-look 自体のライセンスを示す。
- npm / Cargo / Tauri / Rust / Node.js / WebView2 / Xcode / Visual Studio Build Tools など、第三者コンポーネントのライセンスは上書きしない。
- リリース成果物には、可能なら自動生成した第三者ライセンス一覧を同梱する。
- 新しい依存を追加したときは、このメモまたは自動生成フローを更新する。
