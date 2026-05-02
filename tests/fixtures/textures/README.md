# tests/fixtures/textures

このディレクトリには各テクスチャフォーマットの最小テストファイルを置く。

## 自動生成済みファイル

| ファイル                 | フォーマット | 内容                         | 生成方法 / 由来                             |
| ------------------------ | ------------ | ---------------------------- | ------------------------------------------- |
| `1x1.png`                | PNG          | 1×1px RGBA (赤: 255,0,0,255) | `tests/fixtures/_generate.mjs`              |
| `1x1.jpg`                | JPEG / JFIF  | 1×1px RGB (グレー系)         | `tests/fixtures/_generate.mjs`              |
| `crate-grey8.tga`        | TGA          | 256×256 grayscale TGA        | `samples/assets/tga/crate_grey8.tga`        |
| `disturb-dxt1-nomip.dds` | DDS          | DXT1 compressed texture      | `samples/assets/dds/disturb_dxt1_nomip.dds` |
| `2d-uastc.ktx2`          | KTX2         | 2D UASTC sample              | `samples/assets/ktx2/2d_uastc.ktx2`         |

生成コマンド:

```sh
node tests/fixtures/_generate.mjs
```

## 手動配置が必要なフォーマット (TODO)

以下は手書き困難かつ現行 `samples/assets` のファイルが MB 単位のため、
fixture には直接追加しない。必要になったら最小 sample を生成または取得すること。

| ファイル名 (例) | フォーマット | 取得方法                                       |
| --------------- | ------------ | ---------------------------------------------- |
| `sample.hdr`    | Radiance HDR | Poly Haven 等のフリー HDRI をダウンロード      |
| `sample.exr`    | OpenEXR      | Blender でレンダリングするか公開サンプルを取得 |

配置後は `tests/fixtures/README.md` の一覧も更新すること。
