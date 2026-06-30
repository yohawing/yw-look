# tests/fixtures

yw-look のローダー・エラー処理のテスト用フィクスチャ。
基本 fixture は小さく保ち、実データでないと意味が薄い回帰だけ Git LFS 対象として追加する。

## ディレクトリ構成

```
tests/fixtures/
├── models/          # 3D モデルフォーマット (最小モデル)
├── textures/        # テクスチャフォーマット (1×1 pixel)
├── broken/          # 壊れた / 切り詰めたファイル (エラーハンドリングテスト用)
├── catalog.json     # fixture regression runner の公開カタログ
├── _generate.mjs    # PNG / JPG を生成する Node スクリプト
└── README.md        # このファイル
```

---

## models/

| ファイル                           | フォーマット                                          | 内容                                       | 由来                                                                 |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `triangle.gltf`                    | glTF 2.0 (JSON + embedded base64)                     | 1 三角形 (頂点 3 + インデックス 3)         | 手書き JSON                                                          |
| `box-textured.glb`                 | GLB (binary glTF)                                     | 小さい textured box                        | `samples/assets/glb/BoxTextured.glb`                                 |
| `triangle.obj`                     | Wavefront OBJ (ASCII)                                 | 1 三角形                                   | 手書き ASCII                                                         |
| `triangle.stl`                     | STL ASCII                                             | 1 三角形、法線付き                         | 手書き ASCII                                                         |
| `triangle.ply`                     | PLY ASCII 1.0                                         | 1 三角形                                   | 手書き ASCII                                                         |
| `tiny-pointcloud.ply`              | PLY ASCII 1.0                                         | 4 点の point cloud                         | 手書き ASCII                                                         |
| `cactus-supersplat-compressed.ply` | PLY binary little endian (SuperSplat compressed 3DGS) | 139,410 splats; classifier regression only | `3DGS_PLY_sample_data`, CC0; credit URL: https://www.steam-studio.jp |
| `tiny-tetrahedron.dae`             | COLLADA                                               | 1 四面体                                   | `samples/assets/dae/TinyTetrahedron.dae`                             |
| `Samba Dancing.fbx`                | FBX                                                   | Samba dancing animation sample             | `samples/assets/fbx/Samba Dancing.fbx`                               |
| `monkey.abc`                       | Alembic (Ogawa)                                       | Blender Suzanne (static)                   | Blender 3.x エクスポート                                             |

### 手動配置が必要なフォーマット (TODO)

| ファイル名 (例) | フォーマット | 理由                                          |
| --------------- | ------------ | --------------------------------------------- |
| `sample.vrm`    | VRM          | glTF 拡張。VRM 対応ツールから手動エクスポート |

---

## textures/

詳細は `textures/README.md` を参照。

| ファイル                 | フォーマット | 生成方法 / 由来                             |
| ------------------------ | ------------ | ------------------------------------------- |
| `1x1.png`                | PNG          | `node tests/fixtures/_generate.mjs`         |
| `1x1.jpg`                | JPEG         | `node tests/fixtures/_generate.mjs`         |
| `crate-grey8.tga`        | TGA          | `samples/assets/tga/crate_grey8.tga`        |
| `disturb-dxt1-nomip.dds` | DDS          | `samples/assets/dds/disturb_dxt1_nomip.dds` |
| `2d-uastc.ktx2`          | KTX2         | `samples/assets/ktx2/2d_uastc.ktx2`         |
| `venice_sunset_1k.hdr`   | HDR          | `samples/assets/hdr/venice_sunset_1k.hdr`   |
| `piz_compressed.exr`     | EXR          | `samples/assets/exr/piz_compressed.exr`     |

---

## broken/

| ファイル         | 内容                                   | テスト目的                         |
| ---------------- | -------------------------------------- | ---------------------------------- |
| `truncated.gltf` | 途中で切れた JSON (構文エラー)         | JSON パースエラーのハンドリング    |
| `garbage.obj`    | ランダムバイト列を `.obj` 拡張子で保存 | 非テキストデータへのローダーの耐性 |

---

## フィクスチャの再生成

```sh
node tests/fixtures/_generate.mjs
```

PNG / JPG のみ再生成される。モデルファイルは手書きのため再生成不要。

---

## Fixture regression

`tests/fixtures/catalog.json` は、公開 repo に載せられる小型 fixture を
実 loader に通すための構造化カタログである。

```sh
npm run test:fixtures -- --list
npm run test:fixtures -- --case model-obj-triangle
npm run test:fixtures
npm run test:fixtures -- --timeout-ms 600000
```

`npm run test:fixtures` は `scripts/fixture-regression.mjs` から
`scripts/run-shot.mjs check` を呼び、実際の viewer loader / Tauri backend
経路でロード可否を確認する。結果は次に出力する。

- `artifacts/logs/fixture-regression-report.json`
- `artifacts/logs/fixture-regression-report.md`
- `artifacts/logs/fixture-regression-report.html`

通常実行ではモデル読み込みに固定 timeout を設けない。重いモデルや低速環境で
時間がかかる可能性があるためである。CI や短時間の smoke test で上限が必要な
場合だけ `--timeout-ms` を指定する。

巨大・非公開・ライセンス上 commit できない fixture は `samples/private/`
と `samples/private/models.json` に残し、public catalog には追加しない。

`knownFailure` を持つケースは、現時点で再現済みだがまだ修正していない
edge case である。runner は XFAIL として report に残し、通常 fixture が
壊れた場合とは分けて扱う。

---

## Future TODO

- Sketchfab 等のフリーアセット取得スクリプトの整備 (今回スコープ外)
- VRM の自動生成または CI での取得方法の検討
