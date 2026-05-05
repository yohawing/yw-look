# tests/fixtures

yw-look のローダー・エラー処理のテスト用最小フィクスチャ。
全ファイルを合計しても数 KB 以内に収まるよう設計している。

## ディレクトリ構成

```
tests/fixtures/
├── models/          # 3D モデルフォーマット (1 三角形)
├── textures/        # テクスチャフォーマット (1×1 pixel)
├── broken/          # 壊れた / 切り詰めたファイル (エラーハンドリングテスト用)
├── catalog.json     # fixture regression runner の公開カタログ
├── _generate.mjs    # PNG / JPG を生成する Node スクリプト
└── README.md        # このファイル
```

---

## models/

| ファイル               | フォーマット                      | 内容                               | 由来                                     |
| ---------------------- | --------------------------------- | ---------------------------------- | ---------------------------------------- |
| `triangle.gltf`        | glTF 2.0 (JSON + embedded base64) | 1 三角形 (頂点 3 + インデックス 3) | 手書き JSON                              |
| `box-textured.glb`     | GLB (binary glTF)                 | 小さい textured box                | `samples/assets/glb/BoxTextured.glb`     |
| `triangle.obj`         | Wavefront OBJ (ASCII)             | 1 三角形                           | 手書き ASCII                             |
| `triangle.stl`         | STL ASCII                         | 1 三角形、法線付き                 | 手書き ASCII                             |
| `triangle.ply`         | PLY ASCII 1.0                     | 1 三角形                           | 手書き ASCII                             |
| `tiny-tetrahedron.dae` | COLLADA                           | 1 四面体                           | `samples/assets/dae/TinyTetrahedron.dae` |

### 手動配置が必要なフォーマット (TODO)

| ファイル名 (例) | フォーマット | 理由                                                                                 |
| --------------- | ------------ | ------------------------------------------------------------------------------------ |
| `sample.fbx`    | FBX          | 現在の公開 sample は 3.6MB。fixture 用には Blender 等で最小 animation を別途生成する |
| `sample.vrm`    | VRM          | glTF 拡張。VRM 対応ツールから手動エクスポート                                        |

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

HDR / EXR は `textures/README.md` の「手動配置」セクション参照。

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
```

`npm run test:fixtures` は `scripts/fixture-regression.mjs` から
`scripts/run-shot.mjs check` を呼び、実際の viewer loader / Tauri backend
経路でロード可否を確認する。結果は次に出力する。

- `artifacts/logs/fixture-regression-report.json`
- `artifacts/logs/fixture-regression-report.md`

巨大・非公開・ライセンス上 commit できない fixture は `samples/private/`
と `samples/private/models.json` に残し、public catalog には追加しない。

`knownFailure` を持つケースは、現時点で再現済みだがまだ修正していない
edge case である。runner は XFAIL として report に残し、通常 fixture が
壊れた場合とは分けて扱う。

---

## Future TODO

- Sketchfab 等のフリーアセット取得スクリプトの整備 (今回スコープ外)
- FBX / VRM の自動生成または CI での取得方法の検討
- HDR / EXR の最小サンプル取得手順のドキュメント化
