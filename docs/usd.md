# USDプレビュー対応

`yw-look`のUSDプレビューは、単一レイヤーの単純なUSDAをThree.jsの`USDLoader`で表示し、合成や拡張経路が必要なstageを対応範囲を限定したGLB抽出へ送ります。このページは2026-09-04時点の利用者向け契約です。`対応済み`、`degraded`、`unsupported`を分けて記載します。

## Xformを階層とGLBのTRSへ変換する

通常の`Xform`は、`xformOpOrder`に従ってローカル変換を合成し、親から子へワールド変換を構築します。`!resetXformStack!`も階層の境界として扱います。アフィン変換をGLBのtranslation・rotation・scale（TRS）チャンネルへ変換する経路は対応済みです。

時刻付きのXformは、合成されたサンプル時刻を使ってGLBアニメーションを作ります。`startTimeCode`と`endTimeCode`があればその範囲を使い、未設定の場合はxformのサンプル範囲から推定します。USDの`timeCodesPerSecond`をGLBの秒へ変換し、線形補間は`LINEAR`、held補間は`STEP`として出力します。

時間付きXformには安全な上限があります。サンプル数、アニメーションノード数、ベイク時刻数、出力float数を制限し、負の時刻、時刻付き`xformOpOrder`、範囲を作れない単一サンプル、速すぎる回転、同一primで複数の同時回転チャンネルを明示的にunsupportedとして扱います。shear、反射、singularまたは非affineな行列もTRSへ分解できないため対象外です。ビューワーの再生とシークは抽出後のGLBクリップを対象にし、USDステージを毎回再評価する汎用のstateful time evaluatorではありません。

インスペクターの`Animation Range`は、ステージに記録された開始・終了時刻を示すメタデータです。すべての時刻付き属性を走査した結果ではありません。Xformアニメーションのルーティング判定は、このメタデータ表示とは別にbackendで行います。`USDC-INTFLOAT-KNOWN-01`とstatefulなtimeCode抽出は別の既知制約で、XformのTRS抽出とは別に扱います。

## UsdSkelのTRSとウェイトを分けて扱う

`UsdSkel`は、joint名と親子関係、bind/rest transformをGLB skinへ変換します。`skel:joints`によるメッシュごとのjoint順序も読み取り、`SkelAnimation.joints`は名前でskin側のjointへ結び付けます。

jointのTRSと`blendShapeWeights`は独立した時刻列として扱います。ウェイトは`blendShapes`の名前とメッシュのmorph target名を対応させ、対象メッシュだけにGLBのweightチャンネルを作ります。現在のウェイト経路は直接のtime samplesに限定され、staticな既定ウェイトはrest poseの0のままです。

非identityの`primvars:skel:geomBindTransform`は、blend shapeを併用しないskin meshでは頂点と法線へ事前適用します。blend shapeとの併用はunsupportedです。`valueClips`、ウェイトのheld補間、任意のrig表現、未解決または不正なbindingは対応範囲外です。

4つのnative fixtureで、通常のmorph、名前と順序を入れ替えたウェイト、skinとウェイトの併用、GeomSubset分割を確認しています。

- [`weights-proof.json`](../artifacts/usd-skel-weights-20260904/weights-proof.json)
- [`weights-only-reordered-proof.json`](../artifacts/usd-skel-weights-20260904/weights-only-reordered-proof.json)
- [`weights-and-skin-proof.json`](../artifacts/usd-skel-weights-20260904/weights-and-skin-proof.json)
- [`weights-subsets-proof.json`](../artifacts/usd-skel-weights-20260904/weights-subsets-proof.json)

既存階層の二重変換も確認済みです。[`usd-skel-root-20260904/native-proof.json`](../artifacts/usd-skel-root-20260904/native-proof.json)では、同じ親変換下のskinned mesh `Body`と非skinned mesh `Witness`が同じワールド位置になります。追加のroot補正は行いません。

## MaterialXの第一段階契約

MaterialXの第一段階は `7e57902` で実装し、nativeアプリで検証しています。既知のPreview Surface alias（`UsdPreviewSurface`、`ND_UsdPreviewSurface_surfaceshader`、`ND_UsdPreviewSurface`）と、直接接続されたPNG/JPEGテクスチャを対象にします。

テクスチャの`AssetPath`は、記述したlayerの解決結果である`resolved_path()`を所有元として扱います。root側に同じbasenameの囮ファイルがあっても検索で置き換えず、参照元layerの正確なresourceを選びます。native fixtureでは`referenced/same.png`（SHA-256 `4523dc14802e485315b9ac43ca6ef6b2d71dc149e46d955cb71d65e0d1b4f64f`）が選ばれ、root側の囮は除外されました。missing resource、非対応画像形式、未対応graphは、黒表示や無言のscalar fallbackで済ませず、理由付きのdegraded診断として表示する契約です。missing imageの警告はUSD Detailsにも表示されます。

face-varying UVはGLBの三角形展開後に`[[0,1],[1,1],[1,0],[0,1],[1,0],[0,0]]`となります。`Three.flipY=false`で、fixtureの8x8 PNG（元画像は上段が赤・緑、下段が青・黄）をnativeで確認した表示は上段が青・黄、下段が赤・緑です。検証結果、native binary、画像は[`MaterialX VERIFIED.md`](../artifacts/usd-materialx-20260904/VERIFIED.md)にまとめています。

raw`.mtlx`、nestedまたは複雑なNodeGraph forwarding、ORM/roughness経路、PNG/JPEG以外の画像形式は第一段階の対象外です。対応範囲を超えるgraphは明示的にdegradedとします。`info:id`が空でも、raw `.mtlx` の`sourceAsset`を検出して診断します。実体のあるEXRでも拡張子判定までで、EXRデコードは検証対象外です。[`candidate/results.json`](../artifacts/usd-materialx-20260904/candidate/results.json)とfixtureは8ケースの解決・診断資料です。

## USD-authored Gaussian splatの判定

現時点の製品USD経路は、USDからGaussian splatを抽出しません。OpenUSD26.08には、Gaussian splatの公式schemaとして[`ParticleField3DGaussianSplat`](https://openusd.org/release/user_guides/schemas/usdVol/ParticleField3DGaussianSplat.html)があり、scaleとorientationのAPIも[`ParticleFieldScaleAttributeAPI`](https://openusd.org/release/user_guides/schemas/usdVol/ParticleFieldScaleAttributeAPI.html)と[`ParticleFieldOrientationAttributeAPI`](https://openusd.org/release/user_guides/schemas/usdVol/ParticleFieldOrientationAttributeAPI.html)で定義されています。schemaが存在することと、現在の製品経路で表示できることは別の判定です。

native候補の4ケース（pure Gaussian、mixed Gaussian+Mesh、pure Points、mixed Points+Mesh）では、すべて`requires_glb_preview`がtrueになり、`usdAuthoredSplat` capabilityが`detected=true`、`support=unsupported`、理由付きで返ります。pure Gaussianは`ParticleField3DGaussianSplat`を明記した抽出エラーになり、position・orientation・scale・opacity・radianceをGLBへ変換しません。pure Pointsも`Points`を明記した抽出エラーになり、generic PointsをGaussian splatとして扱いません。

mixed Gaussian+Meshとmixed Points+Meshは、それぞれ1 mesh・1 primitiveの1412 byte GLBを生成します。splat/PointsはGLBに含めず、残りのMeshだけを表示します。mixed Gaussianの警告文はnativeのUSD Detailsで確認でき、pure Gaussianのload failureも画面に表示されます。これはUSD-authored Gaussian splatを製品経路で明示的unsupportedとする最終判定です。4ケースのnative結果と画面証拠は[`native/VERIFIED.md`](../artifacts/usd-splat-spike-20260904/native/VERIFIED.md)にまとめています。

Spark 2.1.0でのブラウザー実験は、USD loaderの代替実装ではなく、変換コストのfeasibility確認です。対応付けは次のとおりです。

| USD属性 | 実験での対応 |
| --- | --- |
| `positions` | `PackedSplats.pushSplat`のcenter |
| `orientations`（WXYZ） | 正規化してThree.jsのXYZWへ並べ替え |
| `scales`（linear） | direct経路はlinear、INRIA PLY経路は`log(linear)` |
| `opacities` | direct経路はopacity、INRIA PLY経路はlogit |
| degree 0のradiance spherical harmonics | SH DCからPLYの`f_dc_0..2`へ変換 |

色の復元は`color = 0.5 + SH_C0 * DC`、`SH_C0 = 0.28209479177387814`とし、PLY側では`f_dc = (color - 0.5) / SH_C0`へ戻します。これはdegree 0のDCだけを扱う実験です。

実験はWebGL版SparkとThree.jsだけを使い、WebGPU bridgeはありません。10,000 splatを30 warmup / 60 measured frames / 3 repeatsで測定しました。`normal-sort`は3個のauthored splatを複製した分布、`spatial-grid-normal-sort`は100×100、間隔0.8 world unit、`z=-150`の分布です。

| データセット | direct構築ms | INRIA PLY構築ms | direct rAF中央値ms | PLY rAF中央値ms |
| --- | ---: | ---: | ---: | ---: |
| `normal-sort` | 5.3–7.5 | 68.6–412.5 | 391.7–468.4 | 403.8–409.2 |
| `spatial-grid-normal-sort` | 3.8–6.9 | 39.4–57.9 | 35.0–40.3 | 36.6–40.3 |

`submit`は同期`renderer.render(scene, camera)`の提出時間で、中央値は全条件で0.2–0.3ms、p95は0.3–0.5msでした。`rAF`は次の`requestAnimationFrame`までの間隔で、Sparkの非同期depth sortを含みます。`gl.finish()`を呼ばないため、`submit`はGPU完了時間ではありません。

同じopaque quadを混在させた画像では、左の赤と右の緑のsplatがquadの外に見え、中央のcyan splatはquadの背後に隠れました。USDはY-up、PLYはINRIA file conventionとして扱い、PLY側に追加の上下反転を行っていません。これは方向とocclusion、限定的なoverdrawのsmoke oracleであり、画像品質や完全なdepth-sort parityの検証ではありません。

メモリは`WebGLRenderer.info.memory`のgeometry/texture数と、公開される場合の`performance.memory` JS heapだけを記録しました。10k計測のresource countは概ね`0/0 → 3/5 → 1/1`、JS heap usedは`50,400,000` bytesです。GPU bytes、allocation size、process RSSは計測していません。tiny fixtureではbaseline `1/1`へ10回のload/dispose cycleすべて戻りました。これはmesh lifecycleのbounded smoke evidenceであり、長時間運転や実機GPUのleak証明ではありません。

完走時のrendererはPlaywright ChromiumのSwiftShader software GPUです。したがって、上記のframe timeはreal hardware GPUの性能値ではありません。Vite`http://127.0.0.1:1420`、Spark 2.1.0、Three.js185、headless Chromiumに依存します。以前の60秒timeoutとbare-three harness failureは履歴として保持し、最終10k値には含めていません。

## 検証資料

2026-09-04時点の根拠資料は次のとおりです。

- Xform/UsdSkel: [`artifacts/usd-skel-weights-20260904/VERIFIED.md`](../artifacts/usd-skel-weights-20260904/VERIFIED.md)、[`native-binary.json`](../artifacts/usd-skel-weights-20260904/native-binary.json)
- Skeleton root階層: [`artifacts/usd-skel-root-20260904/native-proof.json`](../artifacts/usd-skel-root-20260904/native-proof.json)
- MaterialX native検証: [`artifacts/usd-materialx-20260904/VERIFIED.md`](../artifacts/usd-materialx-20260904/VERIFIED.md)、[`candidate/results.json`](../artifacts/usd-materialx-20260904/candidate/results.json)、[`native-binary.json`](../artifacts/usd-materialx-20260904/native-binary.json)
- Gaussian splat native判定: [`native/VERIFIED.md`](../artifacts/usd-splat-spike-20260904/native/VERIFIED.md)、[`native/candidate.json`](../artifacts/usd-splat-spike-20260904/native/candidate.json)、[`native/binary.json`](../artifacts/usd-splat-spike-20260904/native/binary.json)
- Gaussian splat計測: [`measurement-summary.json`](../artifacts/usd-splat-spike-20260904/measurement-summary.json)、[`PROVENANCE.md`](../artifacts/usd-splat-spike-20260904/PROVENANCE.md)、[`LIMITATIONS.md`](../artifacts/usd-splat-spike-20260904/LIMITATIONS.md)

ここで参照する`artifacts/`はgit-ignoredのローカル検証資料です。remote cloneには含まれません。
