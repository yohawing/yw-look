# yw-look

**DCCを開く前に、アセットを確認する。**

yw-lookは、3Dモデルやテクスチャを開いて、見た目・アニメーション・ファイルの情報を確認するデスクトップアプリです。受け取ったデータを見たいとき、フォルダ内のアセットを見比べたいとき、制作ツールへ読み込む前の確認に使えます。

![yw-look screenshot](docs/images/hero.png)

_USDZモデルのプレビュー。タイムラインとUSDの構造・警告を同じ画面で確認できます。_

[ダウンロード](https://github.com/yohawing/yw-look/releases/latest) · [変更履歴](CHANGELOG.md) · [不具合の報告](https://github.com/yohawing/yw-look/issues)

現在はAlpha版です。対応範囲や操作は開発に伴って変わります。このREADMEと画像は開発中のv0.3.3を対象としており、公開済みのv0.3.2とはタイムラインやショートカットが異なります。

## できること

- **見た目を確認する** — モデルを回転・拡大して、形状やテクスチャを確認できます。画像、HDR、EXRなども同じアプリで開けます。
- **動きを確認する** — アニメーションの再生・一時停止、フレーム送り、速度変更、ループ範囲の指定ができます。複数のクリップがあるモデルでは、クリップを切り替えて再生できます。
- **データの中身を確認する** — メッシュ・マテリアル・テクスチャの情報や参照の警告を表示します。USDではレイヤー、Prim、バリアントなどの情報も確認できます。

プレビューできる内容は形式とデータによって異なります。読み込み時の警告や対応範囲は、サイドバーで確認できます。

## 使い始める

1. [Releases](https://github.com/yohawing/yw-look/releases/latest)からインストーラーをダウンロードします。公開済みのv0.3.2ではWindows x64向けのセットアップを配布しています。
2. アプリを起動し、ファイルをウィンドウへドラッグ＆ドロップするか、ファイルを開く操作で選びます。
3. Viewportで見た目を確認し、右側のサイドバーでファイル情報や警告を確認します。

VRM、MMD、Gaussian Splatを開く場合は、Settingsから対応するローダーパックをインストールします。パックは個別に追加・削除でき、アプリ更新後も保持されます。

## 対応形式

| 種類             | 標準対応                                  |
| ---------------- | ----------------------------------------- |
| 3Dモデル         | glTF / GLB、FBX、OBJ、PLY、STL、DAE       |
| USD              | USD、USDA、USDC、USDZ                     |
| 画像・テクスチャ | PNG、JPG / JPEG、TGA、DDS、HDR、EXR、KTX2 |

追加のローダーパックで、次の形式をプレビューできます。

| ローダーパック | 対応形式                       |
| -------------- | ------------------------------ |
| VRM            | VRMモデル、VRMAアニメーション  |
| MMD            | PMD / PMXモデル、VMDモーション |
| Gaussian Splat | PLY、SPLAT、SPZ、KSPLAT、SOG   |

標準のPLY読み込みとGaussian SplatのPLY読み込みは、データの種類によって使い分けられます。形式への対応は、その形式のすべての機能を再現することを意味しません。

## 基本操作

以下は開発中のv0.3.3での操作です。

| 操作                                 | キー              |
| ------------------------------------ | ----------------- |
| 再生・一時停止                       | Space             |
| 一時停止して1フレーム戻る・進む      | ← / →             |
| 一時停止して先頭・最終フレームへ移動 | Ctrl＋← / Ctrl＋→ |
| 前・次のファイルを開く               | PageUp / PageDown |
| モデル全体を画面に収める             | Home              |
| 選択した部分にフォーカス             | F                 |
| 視点をリセット                       | R                 |
| グリッドの表示切り替え               | G                 |

タイムラインでは、現在位置をクリックして移動できます。ループ範囲はドラッグで指定し、範囲内の×ボタンで解除します。入力欄やDropdownを操作している間は、その部品のキーボード操作が優先されます。

## 開発する

Node.js 22、Rust stable、[Tauriの前提環境](https://tauri.app/start/prerequisites/)が必要です。WindowsではVisual Studio Build ToolsとWebView2、macOSではXcode Command Line Toolsを用意します。

```bash
npm ci
npm run tauri dev
```

`tauri dev`はフロントエンドの開発サーバーも起動します。ブラウザ側の画面だけを確認する場合は`npm run dev`を使います。ネイティブのファイル読み込みなどはTauriアプリで確認します。

主なビルド・検証コマンドです。

| コマンド                                    | 内容                                                       |
| ------------------------------------------- | ---------------------------------------------------------- |
| `npm run build`                             | フロントエンドをビルド                                     |
| `npm run bundle:win:loaders`                | ローダーパックを含むWindows NSISインストーラーを生成       |
| `npm run bundle:mac`                        | macOS向けアプリ・DMGを生成                                 |
| `npm run check`                             | lint、整形、依存境界、テスト件数、テスト、型チェックを実行 |
| `npm run release:preflight -- --tag v0.3.3` | README画像の更新確認など、リリース前のチェックを実行       |

ビルドできることと、配布物の署名・公証・インストール検証が完了していることは別です。リリースごとの検証状況は[変更履歴](CHANGELOG.md)を参照してください。

<details>
<summary>CLIで読み込みチェック・PNG出力を行う</summary>

開発環境のnpmラッパーから、モデルの読み込み確認やPNG出力を実行できます。内部でViteと`cargo run`を起動するため、上記の開発環境が必要です。

```bash
# 読み込みの成功・失敗を終了コードで確認
npm run shot:check -- --in path/to/model.fbx

# モデル単体をPNGへ出力
npm run shot -- --in path/to/model.glb --out out.png

# 画像サイズと背景を指定
npm run shot -- --in path/to/model.usdz --out out.png --size 1920x1080 --bg transparent
```

| オプション     | 内容                                         |
| -------------- | -------------------------------------------- |
| `--in <path>`  | 入力モデル。必須                             |
| `--out <path>` | PNGの保存先。`shot`で必須                    |
| `--size <WxH>` | 出力サイズ。既定は1024×768、各辺の上限は8192 |
| `--bg <color>` | 背景色。例：`transparent`                    |

現在のバイナリ側CLIもローカルの開発サーバーを参照するため、インストール済みアプリだけで完結する手順としては案内していません。

</details>

<details>
<summary>テストと検証用データ</summary>

![Tests](https://img.shields.io/badge/tests-1306-brightgreen)

以下は`npm run test:count`による静的な集計です。テストの実行結果や、すべての形式・実データでの動作保証を示す件数ではありません。

| 項目                         | 件数 |
| ---------------------------- | ---: |
| テストファイル               |  157 |
| テストケース                 | 1306 |
| フロントエンドのテストケース |  904 |
| Rust のテストケース          |  402 |
| Fixture アセット             |   42 |
| Fixture カタログケース       |   40 |

集計対象は`src/**/__tests__`のVitestファイルと、`src-tauri/src` / `src-tauri/tests`のRust `#[test]`です。パラメーター化したテストなどにより、実行時の件数とは異なる場合があります。

```bash
# 単体テスト
npm test

# モデル描画のスナップショット検証
npm run test:viewport-snapshot

# 指定ケースだけを検証
npm run test:viewport-snapshot -- --case glb-box-textured
```

</details>

READMEの画像は、実モデルを通常のTauri UIで開いて自動撮影しています。更新方法とリリースゲートは[README画像の更新](docs/readme-screenshot.md)を参照してください。

## ライセンス

yw-lookのソースコードは[MIT License](LICENSE)で公開しています。依存ライブラリや同梱素材には、それぞれのライセンスが適用されます。出典とライセンス情報は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。
