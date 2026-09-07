# yw-look

![Status](https://img.shields.io/badge/status-alpha-orange)
![Development](https://img.shields.io/badge/development-active-blue)
![Tests](https://img.shields.io/badge/tests-1306-brightgreen)
![Formats](https://img.shields.io/badge/formats-14-informational)

Tauri v2製のCGアセット確認用の軽量インスペクタ。DCC を起動せず、3Dモデル、テクスチャ、HDR / EXR、メタデータ、欠損参照をすばやく確認するためのデスクトップアプリである。

> **Alpha:** yw-look は現在アクティブ開発中です。UI、対応形式、読み込み挙動、メタデータ表示、検証サンプルは今後変更される可能性があります。

![yw-look screenshot](docs/images/hero.png)

Model: `toy_biplane.usdz`. [Screenshot update workflow](docs/readme-screenshot.md).

**3D:** glTF, FBX, OBJ, PLY, STL, USD, DAE  
**Images:** PNG, JPG, TGA, DDS, HDR, EXR, KTX2  
**Optional Loader Packs:** VRM / VRMA, MMD (PMD / PMX / VMD), Gaussian Splat (PLY / SPLAT / SPZ / KSPLAT / SOG) — Settings からインストール

## 何をするツールか

yw-look は「何でもできるビューア」ではなく、**開く前後の確認作業を短くする道具** である。気軽に開けて、CG制作の現場が必要とするメタ情報やテクスチャ状態をすぐ把握できる。

### 想定ユーザー

- CG 制作（アーティスト、モデラー、ルックデブ、ライティング）
- テクニカルアーティスト
- 納品チェック・受け取り確認の担当者

### 主なユースケース

- 納品アセットの破綻を DCC なしで即座に確認する
- テクスチャの欠損・パス切れをざっくり発見する
- フォルダ内のアセットを順送りで流し見する
- DCC を立ち上げるほどではない軽い確認を済ませる

## 特徴

- **速い** — D&D・右クリック関連付け・起動引数、どこからでもすぐ開ける
- **見抜ける** — ノード数・メッシュ数・テクスチャ欠損・スケール警告をすぐ表示
- **広い** — 3D モデルも画像・テクスチャも一つのアプリで確認できる
- **軽い** — 確認専用。編集・書き出し・変換は行わない
- **自動化できる** — ビルド済みアプリの CLI モードで読み込みチェックと PNG 書き出しを実行できる

## QA / テストカバレッジ

現在の検証状況:

| 項目                         | 件数 |
| ---------------------------- | ---: |
| テストファイル               |  157 |
| テストケース                 | 1306 |
| フロントエンドのテストケース |  904 |
| Rust のテストケース          |  402 |
| Fixture アセット             |   42 |
| Fixture カタログケース       |   40 |
| 対応 3D フォーマット         |    7 |
| 対応画像フォーマット         |    7 |

件数は `npm run test:count` で生成している。静的カウンタは `src/**/__tests__` 配下の Vitest ファイルと、`src-tauri/src` / `src-tauri/tests` 配下の Rust `#[test]` ケースを集計する。

## 開発環境のセットアップ

### 必要なもの

- [Node.js](https://nodejs.org/) 20 以上
- [Rust](https://www.rust-lang.org/) (stable)
- [Tauri CLI の前提環境](https://tauri.app/start/prerequisites/)
  - Windows: Visual Studio Build Tools / WebView2
  - macOS: Xcode Command Line Tools

### 手順

```bash
# 依存をインストール
npm install

# 開発サーバーを起動（ブラウザで確認する場合）
npm run dev

# Tauri デスクトップアプリとして起動
npm run tauri dev
```

## ビルド

```bash
# フロントエンドのビルド
npm run build

# デスクトップアプリのビルド（インストーラー付き）
npm run build:desktop

# Windows 向けインストーラーのみ生成
npm run bundle:win

# macOS 向けインストーラーのみ生成
npm run bundle:mac
```

## Optional Loader Packs

VRM、MMD、Gaussian Splat など一部フォーマットは、コアアプリに同梱せず別途インストールする **Optional Loader Pack** として提供される。

| Pack                       | 対応拡張子                                  | 概要                                                |
| -------------------------- | ------------------------------------------- | --------------------------------------------------- |
| VRM Loader Pack            | `.vrm`, `.vrma`                             | VRM モデル・アニメーションのプレビュー              |
| MMD Loader Pack            | `.pmd`, `.pmx`, `.vmd`                      | MikuMikuDance モデル・モーションのプレビュー        |
| Gaussian Splat Loader Pack | `.ply`, `.splat`, `.spz`, `.ksplat`, `.sog` | 3D Gaussian Splat / SuperSplat 系データのプレビュー |

パックは Settings パネルからインストール・アンインストールできる。インストール済みパックはコアアプリ更新後も保持される。

## CLI モード

ビルド済みの `yw-look` バイナリは、GUI を手で操作せずにアセットの読み込み確認とスクリーンショット生成を実行できる。CI、納品前チェック、バッチ検証で「開けるか」「最低限描画できるか」を確認する用途を想定している。

| Mode      | Purpose                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `--shot`  | モデルを開き、GUI ビューアと同じ Three.js パイプラインで PNG を書き出す |
| `--check` | モデルをロードし、成功 / 失敗を exit code で返す                        |

```bash
# ビルド済みバイナリでモデルを開いて PNG に書き出す
yw-look --shot --in path/to/model.glb --out out.png

# サイズ・背景の指定
yw-look --shot --in model.usdz --out shot.png --size 1920x1080 --bg transparent

# ロードできるかだけ確認（exit code で判定）
yw-look --check --in model.fbx
```

主なオプション:

| Option         | Description                 |
| -------------- | --------------------------- |
| `--in <path>`  | 入力する 3D モデル          |
| `--out <path>` | `shot` の PNG 出力先        |
| `--size <WxH>` | 出力サイズ。例: `1920x1080` |
| `--bg <color>` | 背景色。例: `transparent`   |

`--shot` と `--check` は同時に指定できない。`--shot` では `--in` と `--out` が必須、`--check` では `--in` が必須。`--size` は未指定時 `1024x768`、上限は各辺 `8192`。

開発環境では同じ CLI モードを npm ラッパーから実行できる。

```bash
npm run shot -- --in path/to/model.glb --out out.png
npm run shot:check -- --in path/to/model.fbx
```

npm ラッパーは内部的に Vite dev server と `cargo run` を起動し、ビルド済みバイナリではなく開発環境の Tauri アプリで同じ処理を走らせる。

## コード品質

```bash
# リント
npm run lint

# フォーマットチェック
npm run format:check

# フォーマット実行
npm run format

# 型チェック (TypeScript + Rust fork backend)
npm run typecheck

# TypeScript だけ確認
npm run typecheck:ts

# Rust だけ確認（高速な Rust fork backend）
npm run typecheck:rust


# Cargo を直接使う場合の高速チェック
cargo check-fast

# lint + format:check + typecheck を一括実行
npm run check
```

## テスト

```bash
# 先に dev server を起動して selftest entry を配信する
npm run dev

# 別ターミナルでローダー統合セルフテスト（Playwright）
npm run test:integration -- "http://127.0.0.1:1420/?entry=selftest"

# 別ターミナルでビジュアルリグレッション（snapshot 比較）
npm run test:visual -- "http://127.0.0.1:1420/?entry=selftest"

# viewport screenshot API 由来の PNG snapshot 比較
# 複数ケースでは Tauri アプリを 1 回だけ開き、その中で連続撮影する
npm run test:viewport-snapshot

# 1 ケースだけ確認
npm run test:viewport-snapshot -- --case glb-box-textured

# viewport snapshot baseline 更新
npm run test:viewport-snapshot:update
```

## ライセンス

このリポジトリで管理している yw-look のソースコードは MIT License です。詳細は [LICENSE](LICENSE) を参照してください。

依存ライブラリ、同梱素材、ビルドツール、OS / SDK コンポーネントにはそれぞれのライセンスが適用されます。第三者素材の出典は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
