# yw-look

Windows 向け CG アセット軽量ビューア。  
`macOS Preview / Quick Look` のように、DCC を起動せずに 3D モデルやテクスチャをすぐ確認できる。

## 特徴

- **速い** — D&D・右クリック関連付け・起動引数、どこからでもすぐ開ける
- **広い** — 3D モデルも画像・テクスチャも一つのアプリで確認できる
- **軽い** — 確認専用。編集・書き出し・変換は行わない

## 対応フォーマット

### 3D モデル

| 拡張子 | 形式 |
|--------|------|
| `.glb` / `.gltf` | glTF |
| `.fbx` | FBX |
| `.obj` | OBJ |
| `.ply` | PLY |
| `.stl` | STL |

### テクスチャ / 画像

| 拡張子 | 形式 |
|--------|------|
| `.png` / `.jpg` / `.jpeg` | PNG / JPEG |
| `.tga` | TGA |
| `.dds` | DirectDraw Surface |
| `.hdr` | Radiance HDR |
| `.exr` | OpenEXR |

## 主な機能

- **ファイル入力** — ファイルダイアログ / Drag & Drop / 起動引数 / ファイル関連付け
- **前後移動** — フォルダ内の対応ファイルを `←` / `→` キーで順送り
- **カメラ操作** — `Alt + 左ドラッグ` Orbit、`Alt + 中ドラッグ` Pan、`Alt + 右ドラッグ` / ホイール Zoom
- **表示モード** — テクスチャあり / テクスチャなし / ワイヤーフレーム / 重ね表示
- **アニメーション** — Play / Pause、シークバー、フレーム送り、クリップ切替
- **テクスチャビュー** — RGB / RGBA / Alpha チャンネル表示、HDR / EXR トーンマップ調整
- **メタデータ** — ノード数・メッシュ数・使用テクスチャ数などの統計、階層ツリー、テクスチャ一覧
- **最近開いたファイル** — 最終アクセス日時付きで記録、存在しないパスは自動クリーンアップ
- **エラー表示** — 未対応形式・読み込み失敗・テクスチャ欠損・スケール警告を分かりやすく表示

## 技術スタック

| 役割 | ライブラリ / ツール |
|------|-------------------|
| デスクトップフレーム | [Tauri v2](https://tauri.app/) |
| UI | React 19 + TypeScript |
| ビルド | Vite |
| 3D レンダリング | [Three.js](https://threejs.org/) |
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

## ディレクトリ構成

```
yw-look/
├── src/                  # フロントエンド (React / Three.js)
│   ├── components/       # UI コンポーネント
│   ├── lib/              # ローダー・ビューア・状態管理
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
