# yw-look TODO
 
## 運用

- 新しい作業はまずこの `TODO.md` に記録する。
- `P0` は実装チケットとして扱う。着手時は 1 タスク 1 PR / 1 commit くらいの粒度に保つ。
- `P1+` は設計バックログ。P0 Exit を満たすまで、依存しない調査以外は広げない。
- 完了したタスクは `- [x]` にし、詳細は commit log / PR / 検証ログを正とする。

## Index

- [優先タスク](#優先タスク)
- [後回しにすること](#後回しにすること)
- [完了タスク](#完了タスク)

## 優先タスク

- [x] `Urara_KiwameteKawaii.fbx` のパース失敗を調査し、読み込み可能化または明確な診断エラーを返す（`F:\3dcg\Motion\NanamiUrara_Kiwametekawaii_DanceMotion\Urara_KiwameteKawaii.fbx`）→ `a9ce23e`

- [x] メッシュを含まない animation-only データでも、スケルトン / ボーンだけを 3D ビューに表示できるようにする（例: `C:\Program Files\Autodesk\Maya2026\Examples\Animation\Motion_Capture\FBX` 配下の FBX）→ `cd595af`
- [x] 入力データに含まれる場合、アニメーションクリップごとのフレームレート / キーフレーム数を表示する → `f5ef0ca`
- [x] アニメーションインスペクターを強化する（clip duration、track count、target node / bone、property path、keyframe time range、補間方式を確認できる UI）→ `f5ef0ca`

現状:

- `bench:load` と bench 用スクリーンショット保存経路はあるが、重い実アセットでの継続計測結果は未記録。
- `scripts/batch-load-test.mjs` は現時点では静的列挙のみで、実 loader の成功 / 失敗を記録する実ロードテストではない。

## 19. テスト整備

### テストアセット（#52）

- [ ] fixture 未配置のモデル形式を補う（GLB / DAE は追加済み。FBX は fixture 向け最小 animation 生成方針を確定済みで、生成自体は後続）
- [x] 最小画像 fixture を用意する（`tests/fixtures/textures/`: PNG / JPG）
- [ ] fixture 未配置のテクスチャ形式を補う（TGA / DDS / KTX2 は追加済み。HDR / EXR は MB 単位のため最小 sample 取得方針を README に記録）
- [x] アニメーション付きモデルのサンプルを用意する（`samples/assets/fbx/Samba Dancing.fbx`）
- [ ] アニメーション付きモデルを `tests/fixtures/` 向けに最小化する
- [ ] animation-only FBX の検証サンプルを整理し、メッシュなしでもボーン表示とアニメーション UI が成立する回帰テストを追加する（候補: `C:\Program Files\Autodesk\Maya2026\Examples\Animation\Motion_Capture\FBX`）
- [ ] `Urara_KiwameteKawaii.fbx` のような実モーション FBX を private regression 対象に追加し、FBX パース失敗を再現・検出できるようにする
- [x] 読み込み失敗を再現するための壊れたファイルを用意する（`tests/fixtures/broken/`）

### ユニットテスト / 統合テスト

- [ ] Rust / Tauri 側の設定読み書きテストを書く（`load_settings` / `save_settings`）
- [ ] Rust / Tauri 側の最近開いたファイル管理テストを書く（`load_recent_files` / cleanup / limit / sync）

### ビジュアルリグレッションテスト

- [ ] 各フォーマットを読み込んだ viewer 画面のスナップショットテストを作る（`test:viewport-snapshot` harness に `samples/assets` 由来の USDA / GLB / OBJ / DAE / STL 低解像度 baseline を追加済み。対象フォーマット拡張は後続）
- [ ] エラー画面・空状態・ローディング状態のスナップショットテストを作る

### 起動スピードテスト（#54）

- [ ] 起動時間を自動計測するテストを書く（アプリ起動 → 初回描画までを Playwright / Tauri で測る。#54 では private load bench の手動 threshold 比較まで追加）

## 20. CI/CD 整備

## 24. 将来対応の検討（フォーマット・パフォーマンス）

- [x] `@yohawing/three-mmd-loader` を最新版に更新する（現在 `^0.2.2`、最新 `0.3.1`）→ `25e43f5`
- [ ] VMD（MikuMikuDance モーション）を `loaderRegistry` に拡張子登録する（現状は registry 外で `App.tsx` の drop 経路から既存 PMX/PMD モデルへの motion attach として処理。単独プレビューやファイル関連付けに対応するには registry 登録と `assetKind: "motion"` の扱いが必要）
- [ ] `ufbx` を使った native FBX パスの将来設計をまとめる（現在は Three.js FBXLoader）
- [ ] `DDS` の native 展開が必要か検証する（現在は Three.js DDSLoader で対応済み）
- [ ] サムネイルキャッシュが必要か再評価する（現状は `prefetchCache` による隣接ファイルバッファ先読みのみ）
