# AGENTS

## 役割

このファイルは `yw-look` 開発時に AI が最初に見る参照 Index と、スコープ別の最低限ルールをまとめる。
詳細手順は各ドキュメントを正とする。

## 参照 Index

- `docs/PLAN.md` — プロダクト仕様、対象フォーマット、設計判断
- `docs/DESIGN.md` — UI デザイントークン、コンポーネント仕様、画面設計ルール
- `docs/TODO.md` — 実装チェックリスト、優先度、完了条件
- `docs/native-build.md` — C++ native component のビルド・再生成ルール
- `docs/usd-cpp.md` — OpenUSD C++ backend の詳細手順
- `docs/release-distribution.md` — 配布・リリース確認手順

## スコープ別ルール

- UI 変更: 先に `docs/DESIGN.md` を読み、既存の `src/components/ui` とデザイントークンに合わせる。
- TODO / 設計変更: `docs/TODO.md` または該当設計 doc に、再現条件と完了条件が追える形で残す。
- サンプル検証: 使ったサンプルは `samples/manifest.json` で追える状態にする。
- 記録成果物: スクリーンショットは `artifacts/screenshots/`、ログは `artifacts/logs/` に置く。
- Native / C++ 変更: `docs/native-build.md` を読んでから `src-tauri/build.rs`、`third_party/usd_c_shim/`、`src-tauri/alembic-tools/`、vcpkg / prebuilt payload 周りを触る。
- 配布・リリース: `docs/release-distribution.md` の手順を先に確認する。

## AI 作業ルール

- 実装前に関連ドキュメントと変更対象ファイルを読む。
- 大きな変更では、触る範囲と検証方法を先に明確にする。
- 変更後は最低限の確認を行い、できなかった確認は理由を明記する。
- コミット時は成果物そのものより、再現可能な設定・手順・ソース変更を優先する。
- コミットするなら、`fix` / `update` / `misc` ではなく意図が伝わる名前にする。
