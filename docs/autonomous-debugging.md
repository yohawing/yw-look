# Autonomous Debugging Setup

## 目的

このドキュメントは、`yw-look` を Tauri で開発する際に、AI がなるべく自律的に検証とデバッグを回せるようにするための前提をまとめたものである。

狙いは次の 4 点である。

- サンプルアセットの置き場を固定する
- 検証対象を manifest で管理する
- スクリーンショットやログの保存先を固定する
- 「何を確認すべきか」を AI が毎回迷わないようにする

## ディレクトリ

- `samples/assets/`
  公開可能な検証用サンプルを置く
- `samples/private/`
  ライセンスや容量の都合で共有しないローカル検証用アセットを置く
- `artifacts/screenshots/`
  検証時のスクリーンショット出力先
- `artifacts/logs/`
  検証ログ出力先
- `scripts/`
  検証補助スクリプト

## Git LFS

検証用アセットはサイズが大きくなりやすいため、Git で管理するものは `git lfs` 前提とする。

- 対象拡張子は repo ルートの `.gitattributes` で管理する
- 公開してよいサンプルでも、重いバイナリは通常 Git に直接入れない
- `samples/private/` はローカル専用として扱う
- 新しい形式を足したら LFS 対象も見直す

## 推奨フロー

1. `samples/manifest.example.json` を `samples/manifest.json` にコピーする
2. 手元のサンプルアセットを `samples/assets/` または `samples/private/` に置く
3. `node scripts/verify-sample-layout.mjs` を実行して構成を確認する
4. アプリ側で manifest を読み、対象ファイルを順に検証する
5. 各ケースでスクリーンショットを `artifacts/screenshots/` に保存する
6. 読み込み失敗や警告を `artifacts/logs/` に残す

## 検証観点

各サンプルでは最低限これを見る。

- 起動できるか
- クラッシュしないか
- モデルまたは画像が表示されるか
- エラー時に適切な画面が出るか
- 前後移動できるか
- メタデータが読めるか
- 階層が読めるか
- 使用テクスチャ一覧が出るか
- カメラ操作できるか
- スクリーンショットが撮れるか

## サンプルの揃え方

最低限、形式ごとに次のケースを持つ。

- 正常系の軽いファイル
- 少し重めのファイル
- テクスチャ参照あり
- 埋め込みテクスチャあり
- 参照切れ
- 失敗してもよい異常系

## スクリーンショット命名規則

`<format>__<case>__<view>.png`

例:

- `glb__basic-pbr__default.png`
- `fbx__embedded-textures__wire-overlay.png`
- `exr__hdr-sky__rgb.png`

## ログ命名規則

`<date>__<format>__<case>.log`

例:

- `2026-04-04__glb__basic-pbr.log`
- `2026-04-04__dds__invalid-format.log`

## AI に期待する動き

AI は次を自律的に行える状態を目指す。

- manifest を読んでサンプル群を把握する
- 検証対象を順送りで開く
- 失敗ケースを区別する
- スクリーンショットを保存する
- ログを残す
- 回帰確認時に同じケースを再実行する

## 将来追加したいもの

- サンプルケース一括実行コマンド
- スクリーンショット差分比較
- 失敗ケースの自動要約
- パフォーマンス計測レポート出力
