# tests/fixtures

yw-look のローダー・エラー処理のテスト用最小フィクスチャ。
全ファイルを合計しても数 KB 以内に収まるよう設計している。

## ディレクトリ構成

```
tests/fixtures/
├── models/          # 3D モデルフォーマット (1 三角形)
├── textures/        # テクスチャフォーマット (1×1 pixel)
├── broken/          # 壊れた / 切り詰めたファイル (エラーハンドリングテスト用)
├── _generate.mjs    # PNG / JPG を生成する Node スクリプト
└── README.md        # このファイル
```

---

## models/

| ファイル        | フォーマット                      | 内容                               | 由来         |
| --------------- | --------------------------------- | ---------------------------------- | ------------ |
| `triangle.gltf` | glTF 2.0 (JSON + embedded base64) | 1 三角形 (頂点 3 + インデックス 3) | 手書き JSON  |
| `triangle.obj`  | Wavefront OBJ (ASCII)             | 1 三角形                           | 手書き ASCII |
| `triangle.stl`  | STL ASCII                         | 1 三角形、法線付き                 | 手書き ASCII |
| `triangle.ply`  | PLY ASCII 1.0                     | 1 三角形                           | 手書き ASCII |

### 手動配置が必要なフォーマット (TODO)

| ファイル名 (例) | フォーマット      | 理由                                                            |
| --------------- | ----------------- | --------------------------------------------------------------- |
| `sample.fbx`    | FBX               | バイナリ構造が複雑。Blender / Maya から手動エクスポートが現実的 |
| `sample.glb`    | GLB (binary glTF) | バイナリヘッダが必要。Blender でエクスポート推奨                |
| `sample.dae`    | COLLADA           | XML だが COLLADA 仕様の把握が必要                               |
| `sample.vrm`    | VRM               | glTF 拡張。VRM 対応ツールから手動エクスポート                   |

---

## textures/

詳細は `textures/README.md` を参照。

| ファイル  | フォーマット | 生成方法                            |
| --------- | ------------ | ----------------------------------- |
| `1x1.png` | PNG          | `node tests/fixtures/_generate.mjs` |
| `1x1.jpg` | JPEG         | `node tests/fixtures/_generate.mjs` |

HDR / EXR / DDS / TGA / KTX2 は `textures/README.md` の「手動配置」セクション参照。

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

## Future TODO

- Sketchfab 等のフリーアセット取得スクリプトの整備 (今回スコープ外)
- GLB / FBX / VRM の自動生成または CI での取得方法の検討
- HDR / EXR / DDS の最小サンプル取得手順のドキュメント化
