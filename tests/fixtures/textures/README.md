# tests/fixtures/textures

このディレクトリには各テクスチャフォーマットの最小テストファイルを置く。

## 自動生成済みファイル

| ファイル                 | フォーマット | 内容                         | 生成方法 / 由来                             |
| ------------------------ | ------------ | ---------------------------- | ------------------------------------------- |
| `1x1.png`                | PNG          | 1×1px RGBA (赤: 255,0,0,255) | `tests/fixtures/_generate.mjs`              |
| `1x1.jpg`                | JPEG / JFIF  | 1×1px RGB (グレー系)         | `tests/fixtures/_generate.mjs`              |
| `1x1.jpeg`               | JPEG / JFIF  | `1x1.jpg` と同一バイト列     | `tests/fixtures/_generate.mjs`              |
| `crate-grey8.tga`        | TGA          | 256×256 grayscale TGA        | `samples/assets/tga/crate_grey8.tga`        |
| `disturb-dxt1-nomip.dds` | DDS          | DXT1 compressed texture      | `samples/assets/dds/disturb_dxt1_nomip.dds` |
| `2d-uastc.ktx2`          | KTX2         | 2D UASTC sample              | `samples/assets/ktx2/2d_uastc.ktx2`         |

## samples/assets 参照

HDR / EXR は手書き困難かつ MB 単位のため、`tests/fixtures/textures/`
には重複配置しない。public catalog から既存の `samples/assets/` を参照し、
fixture regression で実 loader 経路を確認する。

| Catalog case ID              | フォーマット | 参照先                                    | サイズ目安 |
| ---------------------------- | ------------ | ----------------------------------------- | ---------- |
| `texture-hdr-venice-sunset`  | Radiance HDR | `samples/assets/hdr/venice_sunset_1k.hdr` | 1.3 MB     |
| `texture-exr-piz-compressed` | OpenEXR      | `samples/assets/exr/piz_compressed.exr`   | 1.8 MB     |

生成コマンド:

```sh
node tests/fixtures/_generate.mjs
```
