# README画像の更新

Windowsで `npm run readme:screenshot` を実行します。Rust、WebView2、`npm ci` 済みの環境と `samples/private/usdz/toy_biplane.usdz` が必要です。モデルはリポジトリへ追加しません。

スクリプトは現在のソースから通常UIのproductionビルドを作り、専用のアプリIDとWebView2プロファイルで起動します。普段使うアプリの設定には触れません。モデルの読み込み後に再生を止め、指定フレーム（現在は3）へ移動し、カメラをリセットして全体を収めてから、固定量の回転・ズームを適用します。1440×960のアプリ画面全体（OSのタイトルバーを除く）を `docs/images/hero.png` へ保存します。

画角は `scripts/readme-screenshot.json` の `orbit` と `pan`（Viewport幅・高さに対するドラッグ量）、`zoomWheel` で調整できます。`frame` で停止位置、`expandSections` で開く情報欄を指定します。モデルを差し替える場合は同ファイルのパスとSHA256も更新します。撮影後は実画像を確認してください。空のViewportやJavaScriptエラーは失敗しますが、構図の良し悪しを自動判定するものではありません。

`npm run check:readme-screenshot` は、画像のハッシュ・寸法・バージョン・撮影設定・ソースのハッシュを撮影記録と照合します。ソースの追加・変更・削除後は撮り直しが必要です。画像と `docs/images/hero.capture.json` を一緒にコミットしてください。HEAD番号は照合しないため、撮影後のコミット自体では無効になりません。

このチェックは `release:preflight` とタグのRelease workflowで必須です。モデルのないCIでも実行でき、画像や記録の欠落・古い記録はskipせず失敗します。CI自体はGPU撮影を行いません。

ビルドログは `artifacts/logs/readme-screenshot-build.log`、専用プロファイルと起動設定は表示されたTEMPディレクトリに残ります。このビルドは撮影用IDを持つため配布には使わず、配布時は通常のbundleコマンドで再ビルドしてください。
