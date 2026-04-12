# Changelog

## v0.1.1 (2026-04-12)

### 3D フォーマット

- USD / USDA / USDC / USDZ 対応 (Rust バックエンド経由の GLB 変換)
  - PBR マテリアル、テクスチャ埋め込み、スキン、アニメーション、variant sets
- COLLADA (.dae) ローダー追加

### テクスチャ

- KTX2 ローダー追加
- テクスチャビューア改善 (ガンマ / 露出 / タイル表示)

### ビューア

- FXAA ポストプロセス
- シャドウ表示
- displayColor / per-vertex color 対応

### デスクトップ統合

- ネイティブメニューバー
- アプリ内アップデーター (GitHub Releases 連携)
- ファイル関連付け (3D モデル + テクスチャ)

### インフラ

- CI パイプライン整備 (lint, typecheck, Rust check, integration test, visual regression)
- Windows NSIS / MSI バンドル対応

## v0.1.0

初期リリース。glTF, FBX, OBJ, PLY, STL および主要画像フォーマットの表示に対応。
