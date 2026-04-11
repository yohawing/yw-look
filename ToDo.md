# yw-look ToDo

## 0. 進め方

- まずは `Tauri + React + Vite + Three.js` の最小骨格を作る
- MVP に直結する機能を優先し、後回し項目は混ぜない
- 速度計測とメモリ解放は初期から組み込む
- 1 つずつ動く状態を保ちながら積み上げる

## 1. プロジェクト初期セットアップ

- [x] `Tauri` プロジェクトを初期化する
- [x] `React + Vite + TypeScript` のフロント構成を作る
- [x] `Three.js` と必要な loader 群を導入する
- [x] 開発用の lint / format / typecheck を整備する
- [x] ディレクトリ構成を決める
- [x] フロントと Tauri 側の責務分離を決める
- [x] ローカル設定保存先の方針を実装に落とす
- [x] サンプルアセット置き場を決める

## 2. アプリ骨格

- [x] 単一ウィンドウの基本レイアウトを作る
- [x] 中央ビューア領域を作る
- [x] 最小ツールバーを作る
- [x] 下部ステータス領域を作る
- [x] 空状態 UI を作る
- [x] ローディング状態 UI を作る
- [x] 代表的なエラー画面 UI を作る

## 3. ファイル入出力と起動導線

- [x] ファイルダイアログから単一ファイルを開けるようにする
- [x] Drag & Drop で開けるようにする
- [x] 起動引数からファイルを受け取れるようにする
- [x] 関連付け起動に必要な受け口を作る
- [x] 現在ファイルのパス / 拡張子 / 種別を状態管理できるようにする
- [x] フォルダ内の対応ファイル列挙処理を作る
- [x] `Left Arrow / Right Arrow` で前後移動できるようにする
- [x] 読み込み失敗時も前後移動を継続できるようにする

## 4. 3D ビューア基盤

- [x] `Three.js` のレンダラー初期化を作る
- [x] シーン / カメラ / ライト / 環境マップの初期化を作る
- [x] 灰色ベース背景を作る
- [x] 初期環境マップ 1 個を導入する
- [x] `fit to view` を実装する
- [x] 初期視点を斜め上に寄せる
- [x] `Y-up` 基準で扱う実装を入れる
- [x] 極端なスケールの警告判定を入れる
- [x] カメラリセットを実装する
- [x] バウンディングボックスに基づく自動スケール正規化を実装する（全フォーマット共通、極端なスケールを自動補正）
- [x] Grid の単位をモデルサイズに応じて動的に切り替える（mm / cm / m 等）
- [x] Grid 単位をステータスバーまたは UI に表示する

## 5. カメラ操作

- [x] `OrbitControls` ベースを組み込む
- [x] `Alt + 左ドラッグ = Orbit` を実装する
- [x] `Alt + 中ドラッグ = Pan` を実装する
- [x] `Alt + 右ドラッグ = Zoom` を実装する
- [x] ホイールズームを実装する
- [x] 操作対象がない時の入力ガードを入れる
- [x] `左ドラッグ = Orbit` を実装する（Alt なし）
- [x] `中ボタンドラッグ = Pan` を実装する（Alt なし）
- [x] `右ドラッグ = Zoom` を実装する（Alt なし）
- [x] モデルのバウンディングボックスに応じてカメラ操作感度（Orbit / Pan / Zoom）を自動調整する
- [x] カメラ操作感度を手動で微調整できるオプションを追加する

## 6. 3D フォーマットローダー

- [x] `glTF / GLB` ローダーを実装する
- [x] `FBX` ローダーを実装する
- [x] `OBJ` ローダーを実装する
- [x] `USD` ローダーを experimental として実装する
- [x] `USD` ローダーで `metersPerUnit` を読み取りスケール補正を適用する（Three.js USDAParser が無視するため極小表示になる）
- [x] `USD` ローダーで個別 `xformOp`（scale / translate / rotateXYZ）をサポートする（現在 matrix4d のみ）
- [x] `PLY` ローダー対応可否を確認し、可能なら実装する
- [x] `DAE` ローダーを実装する（Three.js に ColladaLoader あり、未統合）
- [x] `STL` ローダー対応可否を確認し、可能なら実装する
- [x] 対応拡張子ごとの lazy load を実装する

## 7. テクスチャ / 画像ローダー

- [x] `PNG / JPG / JPEG` 表示を実装する
- [x] `TGA` 表示を実装する
- [x] `HDR` 表示を実装する
- [x] `EXR` 表示を実装する
- [x] `DDS` 表示を実装する
- [x] `KTX2` 表示を実装する（Three.js に KTX2Loader あり、未統合）
- [x] `DDS` 読み込み失敗時のエラー分岐を整理する
- [x] テクスチャ種別ごとの表示初期値を決める
- [x] 画像ファイルのデフォルト表示を 2D ビューにする（フィット表示・パン・ズーム）
- [ ] 2D ビューから 3D プレビュー（板ポリ表示）に切り替えるオプションを追加する
- [x] チャンネル別表示を実装する（R / G / B / A 単独表示切替）
- [x] 露出（EV）調整スライダーを実装する（HDR / EXR 向け）
- [x] ガンマ / リニア表示切替を実装する
- [x] タイリングプレビューを実装する（テクスチャの繰り返し表示）

## 8. 表示モード

- [x] `テクスチャなし` モードを実装する
- [x] `テクスチャあり` モードを実装する
- [x] `ワイヤーフレーム` モードを実装する
- [x] `テクスチャあり + ワイヤーフレーム` モードを実装する
- [x] モード切替 UI を作る
- [x] モード切替時のマテリアル差し替えと復元を安定化する
- [x] 背景色プリセット切り替えを実装する
- [x] ビューポート設定パネルを作る（オーバーレイチップから独立したパネル UI、カテゴリ分けで整理）
- [x] 既存のモード切替チップをパネルに統合する
- [ ] パースペクティブ / オーソグラフィック切替を実装する
- [x] プリセットビューを実装する（Front / Back / Left / Right / Top / Bottom）
- [x] バックフェースカリング ON/OFF を実装する
- [x] 環境マップ背景表示 ON/OFF を実装する（HDRI 背景 or 灰色）
- [x] 環境マップのプリセット切替を実装する（Studio / Outdoor / Neutral 等）
- [x] ボーン / スケルトン表示を実装する（アニメーション付きモデル用）
- [x] 軸ギズモ（XYZ インジケーター）を表示する
- [x] トーンマッピング切替を実装する（Linear / ACES / Reinhard）
- [x] 露出調整スライダーを実装する

## 9. アニメーション UI

- [x] アニメーション有無の判定を実装する
- [x] アニメーション付きモデルだけバーを表示する
- [x] 下部オーバーレイのアニメーションバーを作る
- [x] `Play / Pause` を実装する
- [x] シークバーを実装する
- [x] フレーム送り / 戻しを実装する
- [x] 時間表示を実装する
- [x] 複数クリップ選択 UI を実装する

## 10. テクスチャ単体ビュー

- [x] 画像ビューアと 3D ビューアの切り替え導線を整理する
- [x] `RGB` 表示を実装する
- [x] `RGBA` 表示を実装する
- [x] `Alpha` 表示を実装する
- [x] `HDR / EXR` のトーンマップ調整 UI を実装する
- [x] 白飛び / 黒つぶれを確認しやすい表示調整を入れる
- [x] 必要なら透過チェッカー表示を入れる

## 11. メタデータ / 階層 / 使用テクスチャ

- [x] 基本メタデータ表示 UI を作る
- [x] ファイル形式表示を実装する
- [x] 形式バージョン表示を実装する（MetadataCard で表示済み）
- [x] ノード数 / メッシュ数などの簡易統計を実装する
- [x] アニメーション有無表示を実装する
- [x] 使用テクスチャ数表示を実装する
- [x] 読み取り専用の階層ツリー表示を実装する
- [x] 使用テクスチャ一覧 UI を実装する
- [x] 埋め込み / 外部参照 / 未解決の区別表示を実装する
- [x] 一覧から個別プレビューへ飛べるようにする

## 12. エラー表示と警告

- [x] `未対応形式` エラー画面を作る
- [x] `読み込み失敗` エラー画面を作る
- [x] `参照解決失敗` エラー画面を作る
- [x] `テクスチャ欠損` の警告表示を作る
- [x] `スケール警告` の表示を作る
- [x] エラー発生時の再読み込み導線を作る
- [x] エラー詳細の内部ログ構造を決める

## 13. 最近開いたファイル

- [x] 最近開いたファイルの保存形式を JSON で実装する
- [x] 保存項目を `パス / 最終アクセス日時 / 種別` で実装する
- [x] 最近開いたファイル一覧 UI を作る
- [x] 存在しないパスのクリーンアップを入れる
- [x] 件数上限を決めて実装する

## 14. パフォーマンスと安定性

- [x] 読み込み時間の計測フックを入れる
- [x] 起動時間の計測ポイントを入れる
- [x] 前後移動時間の計測ポイントを入れる
- [x] ローダーの lazy load を全対応拡張子で確認する（全ローダーが dynamic import 使用）
- [x] ファイル切り替え時の `dispose` を徹底する
- [x] `geometry / material / texture` 解放を点検する
- [ ] 重いファイル連続表示時のメモリ挙動を確認する
- [ ] EXR / HDR / DDS の重いケースを試験する

### 起動高速化

- [x] 外部フォント読み込みを最適化する（`preload` + `display=fallback`、またはローカルフォントに変更）
- [x] 起動時の非同期データ読み込みを整理する（設定のみ先行、診断ログ・最近のファイル・統合情報はサイドバー展開時に遅延）
- [x] WebGL シーン初期化をファイル読み込みまで遅延する（PMREMGenerator・環境マップ等）
- [x] サイドバー系コンポーネントを `React.lazy` でコード分割する（DiagnosticsCard / UpdateCard / IntegrationCard 等）
- [x] Vite のビルド設定を見直す（コード分割・チャンク最適化）
- [x] Time to First Paint / Time to Interactive の計測ポイントを追加する

### 重い処理の Rust 側移行

- [ ] Rust 側に移行する処理の優先度を整理する（ファイルパース・バウンディングボックス計算・メタデータ抽出等）
- [ ] 最初の移行対象を決めて Tauri コマンドとして実装する
- [ ] JS 側と Rust 側の責務分離方針をドキュメント化する

### USD インスペクション（Rust バックエンド）

#### Phase 0 — PoC

- [x] `mxpv/openusd` crate で USDA / USDC / USDZ / references / payloads を実アセットで検証する
- [x] Windows MSVC でのビルド障害がないことを確認する
- [x] Phase 0 レポートを `docs/usd.md` にまとめる
- [x] PoC コードを `experiments/usd-poc/` に隔離する
- [x] Phase 0 用の最小 USD サンプル (`tiny.usda`) を `samples/assets/usd/` に追加する

#### Phase 1 — Rust バックエンド骨格

- [x] `UsdBackend` trait を `src-tauri/src/usd/backend.rs` に定義する
- [x] `OpenusdBackend` を fork 版 `openusd` で実装する
- [x] `inspect_stage` / `summarize_stage` / `collect_asset_issues` の Tauri command を公開する
- [x] wire 型 (`StageInspection` / `StageSummary` / `AssetIssue` / `CompositionArc`) を定義する
- [x] `inspectStage` で `metersPerUnit` ヒントをビューアに渡し極小表示を補正する
- [x] Phase 0 実アセットの観察値を回帰テストとして `OpenusdBackend` に組み込む
- [x] 上流 PR 粒度の fork 改造（`up_axis` / `meters_per_unit` / `references_in` / `payloads_in` / `unresolved_assets` / `instanceable` metadata）を取り込む

#### Phase 2 — UX 反映（完了、Web Worker は Phase 3 へ）

- [x] `docs/usd.md` で方針を確定する
- [x] `summarize_stage` を読み込みパイプラインの先頭に挟み、summary を先に表示する
- [x] `StageSummary` をメタデータ / 診断パネルに表示する
- [x] `collect_asset_issues` の結果を警告バナーに表示する
- [x] USDC バイナリを Three.js に渡す前に明示エラーを出す（黙って空描画になるのを防ぐ）
- [ ] `USDLoader.parse` を Web Worker に退避して UI スレッドのブロッキングを崩す（Phase 3 以降）

#### Phase 3 — Rust Geometry パイプライン（yohawing/openusd fork 連携、ほぼ完了）

Three.js USDLoader は USDA テキストしか描画できないため、USDC バイナリ（Kitchen Set 等）の
3D プレビューには Rust 側で geometry を読み出して Three.js に渡すパイプラインが必要。
設計方針は `docs/usd.md` Phase 3 セクションで確定済み。
fork: `yohawing/openusd`（branch: `yw-look-phase3`、`main` 上に phase1 改造を再 port した状態）で実装。

転送方式: **GLB + `tauri::ipc::Response`**

- `ipc::Response` で GLB バイナリをそのまま送出（JSON シリアライズなし）→ JS 側 `invoke<ArrayBuffer>()`
- JS 側は `GLTFLoader.parseAsync(buffer, "")` で受け取る（独自 Loader 不要）
- 将来の animation / texture 拡張も GLTF 仕様に乗れる
- GLTF JSON は手書き（`serde_json::json!`）+ GLB binary container 自前で構築。`gltf` クレート未使用で依存最小

分岐判定: **拡張子ではなく `stage.root_layer_is_binary()` で判定**

- `.usdz` は ZIP コンテナ。root layer が USDA / USDC どちらかは実行時に確認する
- USDA root → `USDLoader.parse`、USDC root → `extract_geometry → GLTFLoader`
- `references` は通常 compose、`payloads` はこのフェーズでは loaded 扱いのまま

- [x] `yohawing/openusd` fork に Mesh geometry 取得 API を追加する
  - [x] `stage.root_layer_is_binary()` — root layer が USDC かどうかを返す（分岐判定用）
  - [x] `stage.mesh_of(prim_path)` — `MeshData { points, face_vertex_indices, face_vertex_counts, normals?, uvs? }` を一括返却（旧 ToDo の `meshes_in/normals_in/uvs_in` 3 本を統合）
  - [x] `stage.local_xform_of(prim_path)` — column-major `[f64; 16]`。**親方向の合成は yw-look 側で実施**（fork は単 prim の local のみ提供）
  - [ ] `stage.material_of(prim_path)` — UsdPreviewSurface の baseColor / roughness / metallic（**Phase 5 に延期**: fork に UsdShade 実装が皆無で、追加コストが大きいため。GLB は default PBR material 1 個で出力）
- [x] Rust 側で USD geometry を GLB バイナリに変換する（`src-tauri/src/usd/glb.rs`、unit test 3 件 PASS）
  - face-varying → vertex-varying 展開（vertex_count vs face_vertex_count をサイズ判定で自動分類、quad/n-gon の fan triangulate）
  - normals 未 authored の場合は face normal を自動生成
  - 全 Mesh を 1 GLB の複数 mesh + 各 mesh に world matrix を node transform で適用
- [x] Tauri command `extract_geometry` / `root_layer_is_binary` を実装（`tauri::ipc::Response` で GLB バイナリ送出）
- [x] フロント側の分岐を「拡張子判定」から「`root_layer_is_binary()` 判定」に切り替える
  - USDA root → `USDLoader.parse`（既存）
  - USDC root → `invoke("extract_geometry") → GLTFLoader.parseAsync`
  - Rust の判定が失敗したら従来の magic-byte sniff に fallback
- [ ] `USDLoader.parse` の Web Worker 退避と合わせて描画パイプラインを整理する（Phase 3.5 / 別フェーズ）
- [x] Kitchen Set で動作検証する
  - `Ball.geom.usd` (USDC root) → `extract_geometry` で正しい GLB 生成（cargo test PASS）
  - `Kitchen_set.usd` (USDA root + 228 USDC references) → multi-mesh 抽出 37MB GLB を release ビルドで 234ms（cargo test PASS）
- [ ] **Tauri 起動での手動 E2E 確認**（`npm run tauri:dev` で `Ball.geom.usd` を開いて 3D ビューに表示されることを目視確認）— ユーザー側で実行

#### Phase 4 — Payload 遅延ロード

- [ ] `docs/usd.md` で Phase 4 方針を確定する
- [ ] `references` は通常 compose、`payloads` のみ deferred 対象にする
- [ ] `summarize_stage` / `inspect_stage` に load policy を導入する
- [ ] `payloads deferred` モードでも hierarchy / issues を表示できるようにする
- [ ] payload prim の `loaded / unloaded / missing` 状態を UI に表示する
- [ ] 必要な payload だけ後から load する API を設計する
- [ ] viewer の再構築または差分更新戦略を決める
- [ ] Kitchen Set クラスで初回表示体験の改善を検証する

#### Phase 5 — Preview 品質向上

- [ ] `docs/usd.md` で Phase 5 方針を確定する
- [ ] variant set 一覧と選択中 variant を inspector に表示する
- [ ] variant 切り替えを preview に反映する
- [ ] purpose (`default` / `render` / `proxy` / `guide`) の表示ポリシーを導入する
- [ ] `PointInstancer` を preview できるようにする
- [ ] `GeomSubset` / face subset 単位の material binding を反映する
- [ ] stage 内 camera の列挙と切り替えを実装する
- [ ] authored camera がない場合の auto-framing を改善する

## 15. OS 統合（Windows / macOS）

### Windows

- [x] 関連付け対象拡張子の設定方法を決める
- [x] インストーラーで関連付けを扱う方法を調べる
- [x] 設定画面から関連付けオン / オフできる余地を作る
- [x] 対象拡張子一覧を UI から参照できるようにする

### macOS

- [x] `tauri.conf.json` の `bundle.targets` を `"all"` に変更し、OS 別ビルドは `--bundles` フラグで制御する
- [x] `src-tauri/icons/` に `.icns` アイコンを追加する
- [x] `bundle.icon` 配列に Windows / macOS / 汎用 PNG をすべて列挙する
- [x] `package.json` に `bundle:mac` スクリプトを追加する（`tauri build -- --bundles app,dmg`）
- [x] macOS 上で `npm run tauri dev` が通ることを確認する
- [x] macOS 上で `npm run bundle:mac` が通ることを確認する
- [x] `tauri.conf.json` の identifier を `com.yohawing.ywlook` に変更する（`.app` 終端を回避）
- [ ] `plugins.updater.windows.installMode` 相当の macOS 側設定を整理する
- [ ] `scripts/prepare-local-update-feed.mjs` を OS 別成果物に対応させる
  - [ ] `nsis` / `msi` だけでなく `macos` / `dmg` ディレクトリも走査する
  - [ ] `.exe` / `.msi` / `.app.tar.gz` / `.dmg` を拡張子で振り分ける
  - [ ] target キーを `windows-x86_64` / `darwin-x86_64` / `darwin-aarch64` で自動判定する
- [ ] Finder からのファイル関連付け（`CFBundleDocumentTypes`）が登録されることを確認する
- [ ] Finder の「このアプリで開く」一覧に出ることを確認する
- [ ] メニュー / ヘルプの `CmdOrCtrl` 表記が macOS で `⌘` として表示されるか確認する
- [ ] Rust 側の Windows 限定文言（`load_supported_extensions` の説明等）を `cfg!(target_os)` で分岐する
- [ ] Rust 側の `\\?\` プレフィクス除去等の Windows 専用パス処理を OS 別に整理する
- [ ] Apple Developer ID 証明書を調達する
- [ ] `codesign` + `notarytool` のフローを実機で確認する
- [ ] `xattr -dr com.apple.quarantine` が必要なケースを `docs/release-distribution.md` に追記する
- [ ] macOS 配布の最終手順を `docs/release-distribution.md` に確定版として反映する

## 16. ログと診断

- [x] 内部ログの保存先を決める
- [x] 開発中にログを確認しやすい導線を作る
- [x] 最低限のエラーコード体系を決める
- [x] パース失敗時の記録内容を決める

## 17. Figma デザインシステム・UI 反映

- [x] `DESIGN.md` のデザイントークン（色・フォント・スペーシング・角丸）を CSS 変数として定義する
- [x] ハードコードされた色値を CSS 変数に置き換える（styles.css 全体）
- [x] Figma のカードコンポーネント仕様に合わせて `.card` スタイルを調整する
- [x] Figma のトップバー仕様に合わせて `.topbar` スタイルを調整する
- [x] Figma のステータスバー仕様に合わせて `.statusbar` スタイルを調整する
- [x] Figma のモードチップ仕様に合わせて `.mode-chip` スタイルを調整する
- [x] Figma のアニメーションバー仕様に合わせて `AnimationBar` を調整する
- [x] Figma のビューアパネル仕様に合わせて `.viewer-panel` を調整する
- [x] Figma のテキストスタイル（`.eyebrow`, `.card-title`, `.muted` 等）を仕様に揃える
- [x] Figma のエラー / 警告 / 空状態の UI を仕様に揃える
- [x] レスポンシブブレイクポイントを Figma の定義に合わせて見直す
- [x] 全コンポーネントの最終的な見た目を Figma と突き合わせて確認する

## 18. メニューバー整理

### 方針

- **デスクトップアプリ（Tauri）**: Tauri のネイティブメニュー API を使用する
- **ブラウザ版**: React コンポーネントでメニューバーを描画する
- メニュー項目の定義は共通化し、プラットフォームごとに表示層を切り替える

### 共通メニュー定義

- [x] メニュー項目の共通定義を作る（項目名・アクション・ショートカットを一箇所で管理）
- [x] Tauri / ブラウザで共通定義からメニューを生成する仕組みを作る

### Tauri ネイティブメニュー（デスクトップ）

- [x] Tauri Menu API でネイティブメニューバーを構築する
- [x] メニューイベントから Rust / フロントエンドへアクションを伝搬する仕組みを作る

### React メニューバーコンポーネント（ブラウザ）

- [x] ドロップダウンメニューの基盤コンポーネントを作る（クリックで開閉・外側クリックで閉じる）
- [x] Tauri 環境ではコンポーネントを非表示にする分岐を入れる

### File メニュー

- [x] `File > Open` を実装する（既存の handleOpenFile をメニューから呼ぶ）
- [x] `File > Recent Files` サブメニューを実装する（最近開いたファイル一覧）
- [x] `File > Exit` を実装する

### View メニュー

- [x] `View > 表示モード切替` を実装する（Texture / Wireframe / Grid）
- [x] `View > カメラリセット` を実装する
- [x] `View > サイドバー表示 / 非表示` を実装する

### Window メニュー

- [x] `Window > フルスクリーン切替` を実装する

### Help メニュー

- [x] `Help > ショートカット一覧` を実装する
- [x] `Help > About`（バージョン情報）を実装する

### キーボードショートカット

- [x] ショートカットキーの一元管理の仕組みを作る（定義 → ハンドラ → 表示を一箇所で管理）
- [x] `Ctrl+O` — File Open を実装する
- [x] `Ctrl+Q` — Exit を実装する
- [x] `F11` — フルスクリーン切替を実装する
- [x] 各表示モードのショートカットを割り当てる
- [x] メニュー項目にショートカット表記を表示する

### Settings 導線

- [x] メニューまたはツールバーから Settings パネルを開く導線を作る

## 19. テスト整備

### テストアセット

- [ ] テスト用アセット置き場を決める（`tests/fixtures/` 等）
- [ ] 各 3D フォーマットの最小テストファイルを用意する（glTF / FBX / OBJ / STL / PLY）
- [ ] 各テクスチャフォーマットの最小テストファイルを用意する（PNG / JPG / TGA / HDR / EXR / DDS）
- [ ] アニメーション付きモデルのテストファイルを用意する
- [ ] 読み込み失敗を再現するための壊れたファイルを用意する

### バッチロードテスト（samples/private）

- [ ] フリーアセットを一括取得するスクリプトを作る（Sketchfab / Poly Haven / KhronosGroup glTF-Sample-Assets 等）
- [ ] `samples/private/` に DL したアセットを配置する（gitignore 済み）
- [ ] 全ファイルを順に読み込んでエラー/警告を記録するバッチテストスクリプトを作る
- [ ] 結果レポートを出力する（成功 / 失敗 / 警告をファイルごとに分類）
- [ ] エラーが出たアセットを原因別に分類・トリアージする

### ユニットテスト / 統合テスト

- [ ] テストフレームワークを導入する（Vitest 等）
- [ ] ローダー選択ロジックのテストを書く（拡張子 → 正しいローダーが選ばれるか）
- [ ] ファイルナビゲーション（前後移動）のテストを書く
- [ ] 設定の読み書きのテストを書く
- [ ] 最近開いたファイル管理のテストを書く

### ビジュアルリグレッションテスト

- [ ] 画面キャプチャの仕組みを調査する（Playwright / Puppeteer / Tauri のスクリーンショット API 等）
- [ ] 各フォーマットを読み込んだ画面のスナップショットテストを作る
- [ ] エラー画面・空状態・ローディング状態のスナップショットテストを作る
- [ ] CI でスナップショットを比較できる仕組みを検討する

### 起動スピードテスト

- [ ] 起動時間を自動計測するテストを書く（アプリ起動 → 初回描画までの時間）
- [ ] 起動時間のしきい値を決めてリグレッション検知できるようにする
- [ ] CI で起動スピードテストを実行する仕組みを検討する

## 20. CI/CD 整備

### CI パイプライン

- [x] GitHub Actions ワークフローを作成する
- [x] Lint / 型チェック（`tsc --noEmit`）を CI で実行する
- [x] ユニットテスト / 統合テストを CI で実行する（selftest）
- [x] ビジュアルリグレッションテストを CI で実行する（Playwright snapshot）
- [x] Rust 側のビルド・テストを CI で実行する（`cargo check` / `cargo test`）
- [ ] PR ごとにチェックを必須にする（branch protection）

### CD パイプライン

- [ ] タグプッシュで Tauri ビルドを自動実行する（Windows / macOS / Linux）
- [ ] ビルド成果物を GitHub Releases にアップロードする
- [ ] 自動アップデート配信の仕組みを整備する（Tauri updater）
- [ ] リリースノートを自動生成する仕組みを検討する

#### macOS リリース対応

- [ ] `.github/workflows/release.yml` に `macos-latest` ランナーのジョブを追加する
- [ ] Windows / macOS のジョブをマトリクス化して並列実行する
- [ ] Apple 署名関連 Secrets を GitHub Secrets に登録する
  - [ ] `APPLE_CERTIFICATE`（`.p12` を base64 化）
  - [ ] `APPLE_CERTIFICATE_PASSWORD`
  - [ ] `APPLE_SIGNING_IDENTITY`
  - [ ] `APPLE_ID`
  - [ ] `APPLE_PASSWORD`（App-specific password）
  - [ ] `APPLE_TEAM_ID`
- [ ] `latest.json` を Windows / macOS 統合フォーマットで生成する
      （`platforms` に `windows-x86_64` / `darwin-x86_64` / `darwin-aarch64` を並べる）
- [ ] macOS 公証ジョブの失敗時に updater feed を更新しないガードを入れる

## 21. 多言語対応（i18n）

- [ ] i18n ライブラリを選定・導入する（react-i18next 等）
- [ ] UI 文字列を翻訳キーに置き換える
- [ ] 日本語・英語の翻訳ファイルを作成する
- [ ] 言語切替の UI を Settings に追加する

## 22. マテリアルプロパティ表示

- [ ] シーン内のマテリアル一覧を取得するロジックを作る
- [ ] マテリアルパネル UI を作る（名前・タイプ・プロパティ表示）
- [ ] PBR プロパティを表示する（baseColor / roughness / metallic / normal / emissive 等）
- [ ] 使用テクスチャのプレビューサムネイルを表示する
- [ ] マテリアルをクリックして該当メッシュをハイライトする

## 23. 3D ビューポートスクリーンショット API

- [ ] WebGL レンダラーから現在のフレームを PNG として書き出す機能を作る
- [ ] Tauri コマンドとして外部から呼び出せるスクリーンショット API を公開する（CLI / IPC）
- [ ] テストから API 経由でスクリーンショットを取得してスナップショット比較に使う

## 24. 将来対応の検討（フォーマット・パフォーマンス）

- [ ] `VRM` ローダーを実装する（Three.js 標準にはなし、外部ライブラリ要）
- [ ] `PMD / PMX / VMD / VRMA` ローダーを実装する（Three.js 標準にはなし、外部ライブラリ要）
- [ ] `Alembic (.abc)` の対応方針を調べる（Three.js 標準にはなし、外部ライブラリ要）
- [ ] `ufbx` を使った native FBX パスの将来設計をまとめる（現在は Three.js FBXLoader）
- [ ] `DDS` の native 展開が必要か検証する（現在は Three.js DDSLoader で対応済み）
- [ ] `USD` の参照解決強化の方針をまとめる（現在は Three.js USDLoader の基本対応のみ）
- [ ] サムネイルキャッシュが必要か再評価する（現在は prefetchCache によるファイルバッファのみ）

### ビューポート追加機能（後回し）

- [x] 法線表示（面法線・頂点法線のライン可視化）
- [ ] UV 展開オーバーレイ表示
- [x] 頂点カラー表示
- [x] バウンディングボックス表示（各メッシュ単位）
- [x] 環境マップ回転
- [x] 影の ON/OFF
- [ ] SSAO（アンビエントオクルージョン）
- [ ] スケールリファレンス（人体シルエット等のサイズ比較）
- [x] FOV / ニアクリップ / ファークリップ調整
- [ ] 被写界深度（DOF）
- [ ] ブルーム（グロー効果）
- [x] アンチエイリアス切替（None / FXAA / MSAA）
- [x] 解像度スケール（0.5x / 1x / 2x）
- [x] テクスチャフィルタリング切替（Nearest / Bilinear / Trilinear）
- [x] FPS / ドローコール / 三角形数 / VRAM のオンスクリーン表示
- [ ] ミップレベル可視化

## 25. 最初の実装順

1. `Tauri + React + Vite + Three.js` の骨格を作る
2. ファイルを 1 つ開いて表示できる状態にする
3. `glTF / GLB` と画像表示を先に通す
4. カメラ操作と前後移動を入れる
5. メタデータ / 階層 / 使用テクスチャ一覧を入れる
6. `FBX / OBJ / DDS / EXR / HDR` を足す
7. 表示モードとアニメーション UI を入れる
8. エラー画面、最近開いたファイル、関連付けを整える
9. 計測とメモリ解放を詰める
