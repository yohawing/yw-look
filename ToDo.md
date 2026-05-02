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
- [x] UE-style fly camera（RMB+WASD、マウスホイールで速度調整） → #25

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
- [x] 2D ビューから 3D プレビュー（板ポリ表示）に切り替えるオプションを追加する
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
- [ ] パースペクティブ / オーソグラフィック切替を実装する（USD / glTF 由来 camera の列挙・選択は実装済み。自由操作カメラ自体の projection 切替 UI は未実装）
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
- [ ] performance regression benchmark を整備する → #54

現状:

- `bench:load` と bench 用スクリーンショット保存経路はあるが、重い実アセットでの継続計測結果は未記録。
- `scripts/batch-load-test.mjs` は現時点では静的列挙のみで、実 loader の成功 / 失敗を記録する実ロードテストではない。

### 自動アップデート（#26）

- [x] Settings に「Auto-check for updates」トグルを追加（initial — schema v4 で `auto_check_for_updates` 永続化、起動後 1 度 `check_for_update` を呼ぶ。install は引き続き手動ボタン）

### 起動高速化

- [x] 外部フォント読み込みを最適化する（`preload` + `display=fallback`、またはローカルフォントに変更）
- [x] 起動時の非同期データ読み込みを整理する（設定のみ先行、診断ログ・最近のファイル・統合情報はサイドバー展開時に遅延）
- [x] WebGL シーン初期化をファイル読み込みまで遅延する（PMREMGenerator・環境マップ等）
- [x] サイドバー系コンポーネントを `React.lazy` でコード分割する（DiagnosticsCard / UpdateCard / IntegrationCard 等）
- [x] Vite のビルド設定を見直す（コード分割・チャンク最適化）
- [x] Time to First Paint / Time to Interactive の計測ポイントを追加する

### 重い処理の Rust 側移行

- [x] Rust 側に移行する処理の優先度を整理する（USD inspection / geometry / composition を優先し、`docs/usd.md` に集約）
- [x] 最初の移行対象を決めて Tauri コマンドとして実装する（USD inspection / geometry extraction / payload session）
- [x] JS 側と Rust 側の責務分離方針をドキュメント化する（`docs/usd.md` / `docs/usd-cpp.md`）
- [ ] USD 以外の重処理（EXR / DDS / 汎用メタデータ抽出など）を Rust 側へ移すか再評価する

### USD インスペクション（Rust バックエンド）

設計・実装記録は `docs/usd.md` を参照。

- [x] **Phase 0** — PoC（`mxpv/openusd` で USDA/USDC/USDZ/composition を実アセット検証、Windows MSVC 確認）
- [x] **Phase 1** — Rust バックエンド骨格（`UsdBackend` trait、`OpenusdBackend`、`inspect_stage` / `summarize_stage` / `collect_asset_issues` Tauri command、fork 改造：`up_axis` / `meters_per_unit` / `references_in` / `payloads_in` / `unresolved_assets` / `instanceable`）
- [x] **Phase 2** — UX 反映（summary 先出し、`UsdInspectorCard` / `WarningsCard` 合流、USDC 明示エラー）
- [x] **Phase 3** — Rust Geometry パイプライン（GLB + `ipc::Response`、`requires_glb_preview` 分岐、fork `mesh_of` + yw-look 側で world xform 合成・Z-up 補正・visibility 継承・leftHanded winding、手書き GLB builder）

#### Phase 4 — Payload 遅延ロード（実装済）

- [x] `summarize_stage` / `inspect_stage` に load policy 導入（stateless API）
- [x] payload prim の `loaded / unloaded / missing` 3 値表示
- [x] UsdInspectorCard に Loaded / Deferred segmented control
- [x] viewer の policy 切替 → extract_geometry 再走 + dispose
- [ ] Kitchen Set で初回表示時間計測
- [x] per-prim payload load/unload（stateful session） → #44

#### Phase 5 — Preview 品質向上（実装済）

- [x] 凹 n-gon ear-clip triangulation（convex fast path 付き）
- [x] UsdPreviewSurface → GLB material（scalar PBR factor + sRGB→linear + alphaMode）
- [x] USDZ / filesystem texture embedding（TextureLoader + per-material sampler dedup）
- [x] displayColor fallback（Kitchen Set 等、constant color → baseColorFactor）
- [x] MaterialX node ID 互換（`ND_UsdPreviewSurface_surfaceshader` / `ND_image_color3`、Glove テクスチャ解決）
- [x] wrapS/wrapT sampler mapping
- [x] USD Skel → glTF skin + animation 全段（skeleton_of / mesh_of skin / skel_animation_of / TRS decompose / time code→秒）
- [x] Variant set resolution 確認 + Windows path fix
- [x] pcp false cycle detection fix（HumanFemale unblock）

#### 今後の USD 課題

USD-view パリティの取り組みは tracking issue #27 配下で進める。

- [x] per-vertex displayColor → GLB `COLOR_0` attribute → #43
- [x] variant set 一覧表示・切り替え UI → #31
- [x] purpose (`default` / `render` / `proxy` / `guide`) 表示ポリシー → #32
- [x] `PointInstancer` preview → #41
- [x] `GeomSubset` / face subset material binding → #42
- [x] stage 内 camera の列挙と切替 → #34（initial — Scene Fixtures カードに gltf.scene 由来の Camera を一覧表示。切替 UI は未実装）
- [x] `USDLoader.parse` を Web Worker に退避 → #45（Phase 2 で scaffold 済み、Phase 3 で USDC/USDZ/composition が Rust GLB 経路に移ったため worker 担当は単一バッファ USDA のみ。default ON、`VITE_USD_WORKER=0` で OFF。失敗時は同期 parse へフォールバック）
- [x] Per-prim attribute inspector → #28
- [x] Layer stack panel → #29（initial — composedLayers をカード内に階層表示）
- [x] Composition arc viewer → #30（CompositionArcsCard で source prim ごとに references / payloads を集約、loaded / missing / unloaded を badge で区別）
- [x] Viewport picking → prim selection sync → #33（initial — viewport クリック → raycast → mesh 名で HierarchyCard をハイライト＆スクロール、tree 側クリックで双方向同期。outline 表示・USD prim path への解決は後続。drag は閾値で除外）
- [x] Light enumeration & list panel → #35（Scene Fixtures カードに gltf.scene 由来の Light を一覧表示、type / intensity / color を表示）
- [x] Material binding panel → #36（initial — MaterialListCard に bound mesh 一覧を表示。USD prim path は GLB round-trip で失われるので mesh 名で代替、shader 種別／input slot 詳細は後続）
- [x] Time samples inspector → #37
- [x] Stage statistics 充実 → #38（prim type counts / vertices / triangles / variant set count）
- [x] usdcat-like flattened text view → #39（initial — UsdSourceCard で .usda / .usd(text) / .usdz(text root) の root layer を表示。regex syntax highlight、256k chars truncation。USDC / USDZ-USDC root は backend `flatten_stage` 待ち）
- [x] Stage metadata panel → #40（time codes / frames per second / start・end time code / comment / root layer format）

## 15. OS 統合（Windows / macOS）

### Windows

- [x] 関連付け対象拡張子の設定方法を決める
- [x] インストーラーで関連付けを扱う方法を調べる
- [x] 設定画面から関連付けオン / オフできる余地を作る
- [x] 対象拡張子一覧を UI から参照できるようにする

### macOS（#50）

- [x] `tauri.conf.json` の `bundle.targets` を `"all"` に変更し、OS 別ビルドは `--bundles` フラグで制御する
- [x] `src-tauri/icons/` に `.icns` アイコンを追加する
- [x] `bundle.icon` 配列に Windows / macOS / 汎用 PNG をすべて列挙する
- [x] `package.json` に `bundle:mac` スクリプトを追加する（`tauri build -- --bundles app,dmg`）
- [x] macOS 上で `npm run tauri dev` が通ることを確認する
- [x] macOS 上で `npm run bundle:mac` が通ることを確認する
- [x] `tauri.conf.json` の identifier を `com.yohawing.ywlook` に変更する（`.app` 終端を回避）
- [ ] `plugins.updater.windows.installMode` 相当の macOS 側設定を整理する（Tauri updater は macOS に同等項目なし。不要なら削除判断する）
- [x] `scripts/prepare-local-update-feed.mjs` を OS 別成果物に対応させる（Windows installer と macOS `.app.tar.gz` を target 別に処理）
  - [x] `nsis` / `msi` だけでなく `macos` ディレクトリも走査する
  - [x] `.exe` / `.msi` / `.app.tar.gz` を拡張子で振り分ける（`.dmg` は updater 対象外）
  - [x] target キーを `windows-x86_64` / `darwin-x86_64` / `darwin-aarch64` で自動判定する
- [ ] Finder からのファイル関連付け（`CFBundleDocumentTypes`）が登録されることを確認する
- [ ] Finder の「このアプリで開く」一覧に出ることを確認する
- [ ] メニュー / ヘルプの `CmdOrCtrl` 表記が macOS で `⌘` として表示されるか確認する
- [ ] Rust 側の Windows 限定文言（`load_supported_extensions` の説明等）を `cfg!(target_os)` で分岐する
- [ ] Rust 側の `\\?\` プレフィクス除去等の Windows 専用パス処理を OS 別に整理する
- [ ] Apple Developer ID 証明書を調達する
- [ ] `codesign` + `notarytool` のフローを実機で確認する
- [x] `xattr -dr com.apple.quarantine` が必要なケースを `docs/release-distribution.md` に追記する
- [ ] macOS 配布の最終手順を `docs/release-distribution.md` に確定版として反映する（現状は想定手順と未整備項目が混在）

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
- [x] #51: View / Selection / Visibility / Display 優先の単キーショートカットを整理する

### Settings 導線

- [x] メニューまたはツールバーから Settings パネルを開く導線を作る

## 19. テスト整備

### テストアセット（#52）

- [x] テスト用アセット置き場を決める（`tests/fixtures/`）
- [x] 最小モデル fixture を用意する（`tests/fixtures/models/`: glTF / OBJ / STL / PLY）
- [ ] fixture 未配置のモデル形式を補う（GLB / FBX / DAE）
- [x] 最小画像 fixture を用意する（`tests/fixtures/textures/`: PNG / JPG）
- [ ] fixture 未配置のテクスチャ形式を補う（TGA / HDR / EXR / DDS / KTX2）
- [x] アニメーション付きモデルのサンプルを用意する（`samples/assets/fbx/Samba Dancing.fbx`）
- [ ] アニメーション付きモデルを `tests/fixtures/` 向けに最小化する
- [x] 読み込み失敗を再現するための壊れたファイルを用意する（`tests/fixtures/broken/`）

### サンプル実ロードテスト（samples/manifest）（#52）

- [x] `samples/manifest.json` で代表サンプルと期待値を管理する
- [x] `selftest.html` / `src/selftest.ts` で主要サンプルを実 loader 経由で読み込む
- [x] `scripts/run-selftest.mjs` で selftest 結果を Playwright から検査する
- [ ] selftest 対象外フォーマットを整理する（現状 DAE / KTX2 / USD は manifest にあっても通常 selftest からは除外）
- [ ] selftest の期待値検証を強化する（現状は読み込み成功 / 失敗中心で、manifest の `expect` 詳細は十分に検証していない）

### バッチロード / ベンチ（samples/private）（#53 / #54）

- [x] フリーアセットを一括取得するスクリプトを作る（`samples/private/fetch.mjs`）
- [x] `samples/private/` に DL したアセットを配置する（gitignore 済み、`samples/private/models.json` で bench 対象を管理）
- [ ] 全ファイルを順に読み込んでエラー/警告を記録するバッチテストスクリプトを作る（現状の `scripts/batch-load-test.mjs` は静的列挙のみ）
- [ ] 結果レポートを出力する（静的列挙結果は `artifacts/logs/batch-load-report.json` に出力済み。実ロードの成功 / 失敗 / 警告分類は未実装）
- [ ] エラーが出たアセットを原因別に分類・トリアージする
- [x] private bench 実行導線を作る（`npm run bench:load` → `scripts/run-load-bench.mjs`）
- [ ] bench 結果を継続比較できる形にする（しきい値 / baseline / trend は未整備）

### ユニットテスト / 統合テスト

- [x] テストフレームワークを導入する（Vitest）
- [x] loader helper のテストを書く（MIME / sibling path / USDC header / USDZ header: `src/viewer/__tests__/loaders.test.ts`）
- [x] KTX2 loader の dynamic import smoke test を書く（`src/viewer/__tests__/ktx2Loader.test.ts`）
- [x] ファイルナビゲーション（前後移動）のテストを書く（`src/viewer/__tests__/prefetchCache.test.ts`）
- [x] メタデータ抽出の回帰テストを書く（階層 / camera / light / material binding: `src/viewer/__tests__/metadata.test.ts`）
- [x] マテリアル shader slot 抽出のテストを書く（`src/viewer/__tests__/materialShaderSlots.test.ts`）
- [x] USD worker gate のテストを書く（`src/viewer/__tests__/usdWorkerLoader.test.ts`）
- [x] UI コンポーネントの回帰テストを書く（Hierarchy / Material / SceneLightsCameras / UsdSource）
- [ ] Rust / Tauri 側の設定読み書きテストを書く（`load_settings` / `save_settings`）
- [ ] Rust / Tauri 側の最近開いたファイル管理テストを書く（`load_recent_files` / cleanup / limit / sync）
- [ ] 実 loader 選択と `loadPreviewObject` の統合テストを書く（現状は helper と selftest に分かれている）

### ビジュアルリグレッションテスト

- [x] 画面キャプチャの仕組みを調査する（Playwright で `selftest.html` を撮影）
- [x] selftest ページのスナップショットテストを作る（`tests/visual/snapshots/selftest-page-linux-chromium.png`）
- [ ] 各フォーマットを読み込んだ viewer 画面のスナップショットテストを作る（`test:viewport-snapshot` harness と `usda-tiny-sanity` baseline は追加済み。対象フォーマット拡張は後続）
- [ ] エラー画面・空状態・ローディング状態のスナップショットテストを作る
- [x] CI でスナップショットを比較できる仕組みを検討する（`visual-regression` job で selftest snapshot と viewport snapshot を比較）

### 起動スピードテスト（#54）

- [x] 起動時間の計測ポイントを実装する（First Paint / Interactive / PerformanceCard）
- [ ] 起動時間を自動計測するテストを書く（アプリ起動 → 初回描画までを Playwright / Tauri で測る）
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

- [x] タグプッシュで Tauri ビルドを自動実行する（Windows / macOS。Linux は配布対象外）
- [x] ビルド成果物を GitHub Releases にアップロードする
- [x] 自動アップデート配信の仕組みを整備する（Tauri updater artifact / local update feed）
- [ ] リリースノートを自動生成する仕組みを検討する

#### macOS リリース対応（#50）

- [x] `.github/workflows/release.yml` に macOS runner のジョブを追加する（`macos-14` / `macos-aarch64`）
- [x] Windows / macOS のジョブをマトリクス化して並列実行する
- [ ] Apple 署名関連 Secrets を GitHub Secrets に登録する（workflow 側の参照は実装済み。Secrets 登録状態は GitHub 上で要確認）
  - [ ] `APPLE_CERTIFICATE`（`.p12` を base64 化）
  - [ ] `APPLE_CERTIFICATE_PASSWORD`
  - [ ] `APPLE_SIGNING_IDENTITY`
  - [ ] `APPLE_ID`
  - [ ] `APPLE_PASSWORD`（App-specific password）
  - [ ] `APPLE_TEAM_ID`
- [ ] `latest.json` を Windows / macOS 統合フォーマットで生成する（local feed は OS 別 target キー対応済み。release artifact の統合 manifest は実リリースで要確認）
      （`platforms` に `windows-x86_64` / `darwin-x86_64` / `darwin-aarch64` を並べる）
- [ ] macOS 公証ジョブの失敗時に updater feed を更新しないガードを入れる

## 21. 多言語対応（i18n）

- [ ] i18n ライブラリを選定・導入する（react-i18next 等）
- [ ] UI 文字列を翻訳キーに置き換える
- [ ] 日本語・英語の翻訳ファイルを作成する
- [ ] 言語切替の UI を Settings に追加する

## 22. マテリアルプロパティ表示

- [x] シーン内のマテリアル一覧を取得するロジックを作る
- [x] マテリアルパネル UI を作る（名前・タイプ・プロパティ表示）
- [x] PBR プロパティを表示する（baseColor / roughness / metallic / normal / emissive 等）
- [ ] 使用テクスチャのプレビューサムネイルを表示する
- [ ] マテリアルをクリックして該当メッシュをハイライトする

## 23. 3D ビューポートスクリーンショット API（#48）

- [x] WebGL レンダラーから現在のフレームを PNG として書き出す機能を作る（`src/viewer/screenshot.ts`）
- [x] CLI として外部から呼び出せるスクリーンショット機能を公開する（`yw-look --shot --in <model> --out <png>` / `--check`。`shot.html` + `src/shot/` + Tauri commands `get_shot_config` / `write_shot_output` / `finish_shot_run`。`npm run shot -- --in ... --out ...` から起動）
- [x] テストから shot CLI 経由でスクリーンショットを取得してスナップショット比較に使う（`scripts/viewport-snapshot.mjs` + `tests/visual/snapshots/viewport/usda-tiny-sanity.png`）

## 24. 将来対応の検討（フォーマット・パフォーマンス）

- [ ] `VRM` ローダーを実装する（Three.js 標準にはなし、外部ライブラリ要）
- [ ] `PMD / PMX / VMD / VRMA` ローダーを実装する（Three.js 標準にはなし、外部ライブラリ要）
- [ ] `Alembic (.abc)` の対応方針を調べる（Three.js 標準にはなし、外部ライブラリ要）
- [ ] `ufbx` を使った native FBX パスの将来設計をまとめる（現在は Three.js FBXLoader）
- [ ] `DDS` の native 展開が必要か検証する（現在は Three.js DDSLoader で対応済み）
- [x] `USD` の参照解決強化の方針をまとめる（Rust / C++ backend 方針は `docs/usd.md` / `docs/usd-cpp.md` に集約）
- [ ] サムネイルキャッシュが必要か再評価する（現状は `prefetchCache` による隣接ファイルバッファ先読みのみ）

### ビューポート追加機能（後回し）

- [x] 法線表示（面法線・頂点法線のライン可視化）
- [ ] UV 展開オーバーレイ表示
- [x] 頂点カラー表示
- [x] バウンディングボックス表示（各メッシュ単位）
- [x] 環境マップ回転
- [x] 影の ON/OFF
- [x] FOV / ニアクリップ / ファークリップ調整
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
