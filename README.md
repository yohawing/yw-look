# yw-look ― 3Dモデルインスペクター

**様々な形式の3Dモデルをクイックに開いて確認できるアプリです**

3Dモデルやテクスチャを開いて、メッシュ・アニメーション・ファイルの情報を確認するTauri v2+Three.js製のデスクトップアプリです。受け取ったデータを見たいとき、フォルダ内のアセットを見比べたいとき、DCCツールへ読み込む前の確認に使えます。

![yw-look screenshot](docs/images/hero.png)

## 対応フォーマット

「✅️」はプレビュー用の読み込み経路が実装済みであることを示します。形式固有の機能や制限は備考を参照してください。

### 3Dモデル・モーション（標準対応）

| フォーマット | 拡張子                         | 対応状況     | 備考                                                                                                                                                                                                                   |
| ------------ | ------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| glTF         | `.gltf` `.glb`                 | ✅️           | [Three.js GLTFLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/GLTFLoader.js)を使用。モデル・マテリアル・アニメーションのプレビュー。外部参照のあるデータは、テクスチャやバッファも必要です。 |
| FBX          | `.fbx`                         | ✅️           | [ufbx](https://github.com/ufbx/ufbx)を使用。モデル・テクスチャ・アニメーションのプレビュー。制作ツール固有のシェーダーやリグの完全再現は対象外です。                                                                   |
| OBJ          | `.obj`                         | ✅️           | [Three.js OBJLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/OBJLoader.js)を使用。静的メッシュの表示。MTLと外部テクスチャの参照を読み込みます。                                              |
| PLY          | `.ply`                         | ✅️           | [Three.js PLYLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/PLYLoader.js)を使用。メッシュ・点群の表示。Gaussian Splat形式のPLYには追加パックが必要です。                                    |
| STL          | `.stl`                         | ✅️           | [Three.js STLLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/STLLoader.js)を使用。メッシュ形状の確認向けです。                                                                               |
| 3MF          | `.3mf`                         | 一部対応     | Core 3MFのメッシュ・部品階層・単位・基本マテリアルと、頂点カラー・PNG/JPEGテクスチャをプレビューします。外部モデル参照や未対応の必須拡張は読み込みを拒否し、その他の未対応要素は警告します。                           |
| COLLADA      | `.dae`                         | 一部対応     | [Three.js ColladaLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/ColladaLoader.js)を使用。モデルと外部テクスチャのプレビュー。現在の読み込み経路ではアニメーションクリップを取り込みません。 |
| Rhino 3DM    | `.3dm`                         | ✅️           | Windowsでは分離プロセスのopenNURBS helperを使用し、その他の環境ではThree.js Rhino3dmLoaderへフォールバックします。mesh/Brep/extrusion/SubD/curve/point/点群、layer/instance、basic materialをプレビューします。        |
| USD          | `.usd` `.usda` `.usdc` `.usdz` | 一部対応     | [openusd（Rust）](https://github.com/mxpv/openusd)を使用。形状・マテリアル・一部アニメーションのプレビューと、レイヤー・Prim・バリアント等の検査。UsdSkelやMaterialXなどは対応範囲に制限があり、警告を表示します。     |
| Alembic      | `.abc`                         | 条件付き対応 | [Alembic](https://github.com/alembic/alembic)を使う専用ヘルパーを使用。メッシュ形状・頂点アニメーションのプレビュー。対応するネイティブ変換ヘルパーが必要です（Windows x64 / macOS arm64向け）。                       |
| BVH          | `.bvh`                         | ✅️           | [Three.js BVHLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/BVHLoader.js)を使用。骨格とモーションのプレビュー。モデル形状を含む形式ではありません。                                         |

IFC・Rhino 3DM・3MFは、Settingsの **CAD Loader Pack** でまとめて有効／無効を切り替えます。関連ランタイムは引き続きアプリに同梱します。

Rhino 3DMは編集・保存、Grasshopper定義やRhinoプラグイン固有データの実行、Rhino表示モードの完全再現には対応しません。未変換の要素や不足リソースは警告として表示します。

### 画像・テクスチャ（標準対応）

| フォーマット | 拡張子         | 対応状況     | 備考                                                                                                                                                                                 |
| ------------ | -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PNG          | `.png`         | ✅️           | [Three.js TextureLoader](https://github.com/mrdoob/three.js/blob/r185/src/loaders/TextureLoader.js)を使用。画像と透過部分の確認に使えます。                                          |
| JPEG         | `.jpg` `.jpeg` | ✅️           | [Three.js TextureLoader](https://github.com/mrdoob/three.js/blob/r185/src/loaders/TextureLoader.js)を使用。写真やカラーテクスチャのプレビュー。                                      |
| TGA          | `.tga`         | ✅️           | [Three.js TGALoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/TGALoader.js)を使用。TGAテクスチャのプレビュー。                                              |
| DDS          | `.dds`         | 条件付き対応 | [Three.js DDSLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/DDSLoader.js)を使用。圧縮テクスチャのプレビュー。圧縮形式と実行環境の対応状況に依存します。   |
| PSD          | `.psd`         | 一部対応     | [psd（Rust）](https://docs.rs/psd/0.3.5/psd/)を使用。レイヤーを合成した画像として表示します。レイヤー編集用の表示ではありません。                                                    |
| HDR          | `.hdr`         | ✅️           | [Three.js RGBELoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/RGBELoader.js)を使用。HDR画像をデコードしてプレビューします。                                |
| OpenEXR      | `.exr`         | ✅️           | [Three.js EXRLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/EXRLoader.js)を使用。EXR画像をデコードしてプレビューします。                                  |
| KTX2         | `.ktx2`        | 条件付き対応 | [Three.js KTX2Loader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/KTX2Loader.js)を使用。圧縮テクスチャのプレビュー。レンダラーに合わせてトランスコードします。 |

### 追加ローダーパック

対応パックをインストールすると、次の形式をプレビューできます。

| フォーマット   | 拡張子                                  | 必要なパック   | 対応状況 | 備考                                                                                                                                                    |
| -------------- | --------------------------------------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VRM            | `.vrm`                                  | VRM            | ✅️       | [three-vrm](https://github.com/pixiv/three-vrm)を使用。VRMモデルを専用ローダーで読み込みます。`.vrma`は未実装です。                                     |
| MMDモデル      | `.pmd` `.pmx` `.vmd`                    | MMD            | ✅️       | [three-mmd-loader](https://github.com/yohawing/three-mmd-loader)を使用。モデル・テクスチャ・モーフのプレビュー。MMD固有の骨制約などには制限があります。 |
| Gaussian Splat | `.ply` `.splat` `.spz` `.ksplat` `.sog` | Gaussian Splat | ✅️       | [Spark](https://github.com/sparkjs-dev/spark)を使用。Gaussian Splatデータを専用レンダラーで表示します。PLYは内容からメッシュ・点群・Splatを判別します。 |

## 使い始める

1. [Releases](https://github.com/yohawing/yw-look/releases/latest)からインストーラーをダウンロードし、インストールします。
2. アプリを起動し、ファイルをウィンドウへドラッグ＆ドロップするか、拡張子を関連付けすればそのまま開けます。
3. 右側のサイドバーでファイル情報や警告を確認します。

## CLIの使い方

`yw-look`コマンドで、モデルの読み込みチェックやPNG出力を実行できます。実行ファイルのあるディレクトリをPATHに追加するか、実行ファイルをフルパスで指定してください。

```bash
# 読み込みの成功・失敗を終了コードで確認
yw-look --check --in "path/to/model.fbx"

# モデル単体をPNGへ出力
yw-look --shot --in "path/to/model.glb" --out "out.png" --size 1920x1080 --bg transparent
```

`--in`は入力ファイル、`--out`はPNGの保存先です。`--size`と`--bg`は省略できます。

配布ビルドのCLIは同梱の画面で処理するため、Node.js・Rust・開発サーバーは不要です。開発ビルドでは、`localhost:1420`で開発サーバーを起動して実行してください。

## ライセンス

このアプリのソースコードは[MIT License](LICENSE)です。依存ライブラリや同梱素材には、[それぞれのライセンス](THIRD_PARTY_NOTICES.md)が適用されます。
