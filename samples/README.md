# Sample Assets

## 目的

このディレクトリは `yw-look` の検証用サンプルを置く場所である。

## 置き方

- 公開して問題ないものは `samples/assets/`
- 個人所有や容量大のものは `samples/private/`

## 推奨カテゴリ

- `glb`
- `gltf`
- `fbx`
- `obj`
- `usd`
- `dds`
- `exr`
- `hdr`
- `tga`
- `ktx2`
- `ply`
- `dae`
- `stl`
- `vrm`

## 1 ケースあたりあると良いもの

- 正常系
- 少し重い版
- 外部参照あり
- 埋め込みあり
- 参照切れ
- 失敗系

## メモ

- `samples/manifest.json` で管理する
- ライセンス不明の素材はコミットしない
- 実案件ファイルを置くなら `samples/private/` を使う

## Private samples

`samples/private/` は git には含めないローカル検証用サンプル置き場である。

Khronos glTF Sample Assets などの大きめの検証素材は次で取得する。

```sh
npm run samples:fetch
```

取得済み private サンプルの一覧は次で確認する。

```sh
npm run test:batch -- --list
```

単体ロードチェックは次のように実行する。

```sh
npm run test:batch -- --case boombox
```
