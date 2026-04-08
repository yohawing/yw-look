# tests/fixtures/textures

このディレクトリには各テクスチャフォーマットの最小テストファイルを置く。

## 自動生成済みファイル

| ファイル | フォーマット | 内容 | 生成方法 |
|----------|-------------|------|---------|
| `1x1.png` | PNG | 1×1px RGBA (赤: 255,0,0,255) | `tests/fixtures/_generate.mjs` |
| `1x1.jpg` | JPEG / JFIF | 1×1px RGB (グレー系) | `tests/fixtures/_generate.mjs` |

生成コマンド:

```sh
node tests/fixtures/_generate.mjs
```

## 手動配置が必要なフォーマット (TODO)

以下は手書き困難なバイナリフォーマットのため、手動でサンプルファイルを配置すること。

| ファイル名 (例) | フォーマット | 取得方法 |
|----------------|-------------|---------|
| `sample.hdr`   | Radiance HDR | Poly Haven 等のフリー HDRI をダウンロード |
| `sample.exr`   | OpenEXR | Blender でレンダリングするか公開サンプルを取得 |
| `sample.dds`   | DirectDraw Surface | texconv (Microsoft) またはゲームアセット |
| `sample.tga`   | TARGA | 画像編集ソフトから手動エクスポート |
| `sample.ktx2`  | KTX2 | toktx (KTX-Software) で変換 |

配置後は `tests/fixtures/README.md` の一覧も更新すること。
