# yw-look

Windows 向け CG アセット確認用の軽量インスペクタ。  
DCC を起動せず、壊れたアセットや確認ポイントをすぐ見抜ける。

## 何をするツールか

yw-look は「何でもできるビューア」ではなく、**開く前後の確認作業を短くする道具** である。  
`macOS Quick Look` のように気軽に開けて、CG 制作の現場が必要とするメタ情報やテクスチャ状態をすぐ把握できる。

### 想定ユーザー

- CG 制作（アーティスト、モデラー、ルックデブ、ライティング）
- テクニカルアーティスト
- 納品チェック・受け取り確認の担当者

### 主なユースケース

- 納品アセットの破綻を DCC なしで即座に確認する
- テクスチャの欠損・パス切れをざっくり発見する
- フォルダ内のアセットを順送りで流し見する
- DCC を立ち上げるほどではない軽い確認を済ませる

## 特徴

- **速い** — D&D・右クリック関連付け・起動引数、どこからでもすぐ開ける
- **見抜ける** — ノード数・メッシュ数・テクスチャ欠損・スケール警告をすぐ表示
- **広い** — 3D モデルも画像・テクスチャも一つのアプリで確認できる
- **軽い** — 確認専用。編集・書き出し・変換は行わない

## 対応フォーマット

### 3D モデル

| 拡張子 | 形式 | 状態 |
|--------|------|------|
| `.glb` / `.gltf` | glTF | 対応済み |
| `.fbx` | FBX | 対応済み |
| `.obj` | OBJ | 対応済み |
| `.ply` | PLY | 対応済み |
| `.stl` | STL | 対応済み |
| `.usd` / `.usda` / `.usdc` / `.usdz` | USD | 対応済み（experimental） |
| `.dae` | COLLADA | 未実装（将来対応候補） |
| `.vrm` | VRM | 未実装（将来対応候補） |

### テクスチャ / 画像

| 拡張子 | 形式 | 状態 |
|--------|------|------|
| `.png` / `.jpg` / `.jpeg` | PNG / JPEG | 対応済み |
| `.tga` | TGA | 対応済み |
| `.dds` | DirectDraw Surface | 対応済み |
| `.hdr` | Radiance HDR | 対応済み |
| `.exr` | OpenEXR | 対応済み |
| `.ktx2` | KTX2 | 未実装（将来対応候補） |

## 主な機能

- **ファイル入力** — ファイルダイアログ / Drag & Drop / 起動引数 / ファイル関連付け
- **前後移動** — フォルダ内の対応ファイルを `←` / `→` キーで順送り
- **カメラ操作** — `Alt + 左ドラッグ` Orbit、`Alt + 中ドラッグ` Pan、`Alt + 右ドラッグ` / ホイール Zoom
- **表示モード** — テクスチャあり / テクスチャなし / ワイヤーフレーム / 重ね表示
- **アニメーション** — Play / Pause、シークバー、フレーム送り、クリップ切替
- **テクスチャビュー** — RGB / RGBA / Alpha チャンネル表示、HDR / EXR トーンマップ調整
- **インスペクション** — ノード数・メッシュ数・マテリアル数・使用テクスチャ数の統計、階層ツリー、テクスチャ一覧と欠損検出
- **最近開いたファイル** — 最終アクセス日時付きで記録、存在しないパスは自動クリーンアップ
- **エラー表示** — 未対応形式・読み込み失敗・テクスチャ欠損・スケール警告を分かりやすく表示

## アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│  UI 層 (React)                                       │
│  App.tsx / Sidebar Cards / AnimationBar              │
├─────────────────────────────────────────────────────┤
│  Viewer Controller 層                                │
│  AssetViewport.tsx — シーン管理・表示モード・カメラ    │
├─────────────────────────────────────────────────────┤
│  アセット解析層                                       │
│  viewer/loaders — フォーマット別ローダー               │
│  viewer/metadata — メタデータ収集・テクスチャ解析      │
│  viewer/scene — Three.js シーン操作                   │
├─────────────────────────────────────────────────────┤
│  OS 統合層 (Tauri / Rust)                            │
│  ファイル I/O・パス解決・設定・診断・アセット検査       │
└─────────────────────────────────────────────────────┘
```

## 技術スタック

| 役割 | ライブラリ / ツール |
|------|-------------------|
| デスクトップフレーム | [Tauri v2](https://tauri.app/) |
| UI | React 19 + TypeScript |
| ビルド | Vite |
| 3D レンダリング | [Three.js](https://threejs.org/) |
| バックエンド | Rust |
| インストーラー | NSIS / MSI |

## 開発環境のセットアップ

### 必要なもの

- [Node.js](https://nodejs.org/) 20 以上
- [Rust](https://www.rust-lang.org/) (stable)
- [Tauri CLI の前提環境](https://tauri.app/start/prerequisites/) (Windows の場合は Visual Studio Build Tools など)

### 手順

```bash
# 依存をインストール
npm install

# 開発サーバーを起動（ブラウザで確認する場合）
npm run dev

# Tauri デスクトップアプリとして起動
npm run tauri dev
```

## ビルド

```bash
# フロントエンドのビルド
npm run build

# デスクトップアプリのビルド（インストーラー付き）
npm run build:desktop

# Windows 向けインストーラーのみ生成
npm run bundle:win
```

## コード品質

```bash
# リント
npm run lint

# フォーマットチェック
npm run format:check

# フォーマット実行
npm run format

# 型チェック (TypeScript + Cargo)
npm run typecheck

# lint + format:check + typecheck を一括実行
npm run check
```

## テスト

```bash
# ローダー統合セルフテスト（Playwright）
npm run test:integration -- http://127.0.0.1:1420/selftest.html

# ビジュアルリグレッション（snapshot 比較）
npm run test:visual -- http://127.0.0.1:1420/selftest.html
```

## ディレクトリ構成

```
yw-look/
├── src/                  # フロントエンド (React / Three.js)
│   ├── components/       # UI コンポーネント
│   ├── viewer/           # ビューア・ローダー・シーン管理
│   ├── lib/              # Tauri IPC ラッパー
│   └── App.tsx
├── src-tauri/            # Tauri バックエンド (Rust)
│   ├── src/              # Rust ソース
│   └── tauri.conf.json   # Tauri 設定
├── docs/                 # ドキュメント
├── samples/              # 検証用サンプルアセット
└── artifacts/            # ビルド成果物・ログ・スクリーンショット
```

## ライセンス

このリポジトリのライセンスについては、リポジトリオーナーにお問い合わせください。
