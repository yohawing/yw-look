# AGENTS

## 目的

このファイルは、`yw-look` を AI と共同で開発する際の作業ルールを定義する。

狙いは次のとおり。

- 作業履歴を追いやすくする
- 途中経過を壊れにくくする
- コミット単位でレビューしやすくする
- AI が自律的に進めても品質を落としにくくする

## Alpha 開発モード（期間限定オーバーライド）

> **このセクションは alpha 期間中のみ有効。** 開始日: 2026-04-09。終了タイミングはオーナー (yohawing) が決める。解除時はこのセクション丸ごと削除し、後続セクションの通常ルールに戻す。

Alpha 期は反復速度を優先し、以下のルールで後続セクションの一部を上書きする。

### やめるもの

- 機能ごとに作業ブランチを切る義務 → `develop` / `main` への直接 commit / push を許可する
- `gh pr create --base develop` による通常開発 PR
- release 時の `develop` → `main` PR（tag だけ `main` に打てば release workflow が走る）
- Sonnet サブエージェントへの PR レビュー対応委任（PR を作らないので不要）

### 許可するもの

- `develop` への直接 commit / push
- `main` への直接 push（release の tag 打ちのために `main` を `develop` に FF させる運用を含む）
- 複数の意図を 1 コミットに混ぜること（分けられるなら分ける、が義務ではない）
- 「動く状態」を満たせない中間コミット（ただし命名ルールは維持）

### 変わらず守るルール

- release tag は `main` に打つ（`release.yml` の trigger は `push: tags v*`。`main` が release 対象ブランチ）
- hotfix は従来どおり `main` から `hotfix/*` を切って取り込み、同じ変更を `develop` にも反映する（Alpha 期は PR なしで直接 push でも可）
- コミット名の質は維持する（`fix` / `wip` / `update` / `misc` など禁止、意図が伝わる名前にする）
- **Codex review は USD / Three.js / Rust などの touchy 領域を触る場合、コミット前に必ず通す**。UI の小さい調整やドキュメント更新は任意
- LFS ルール、`experiments/` 非 commit ルール、`DESIGN.md` 参照義務は維持

### CI の扱い

- `ci.yml` の trigger に `push: develop` を追加し、PR なしでも CI が自動実行される状態を維持する
- CI 失敗は後追いで修正する方針（PR のように merge を止める gate ではない）
- 失敗が積み上がってきたら即修正する。壊れた状態を放置しない

### AI への指示（Alpha 期間中）

- デフォルトで `develop` に直接 commit する。明示的にブランチを切るよう指示された場合のみ従う
- PR を自動で作成しない。オーナーから明示指示があった場合のみ作成する
- Codex review は touchy 領域で必須を維持。レビューを飛ばした場合はコミットメッセージ本文に理由を書く
- `main` への push（release tag 打ち / hotfix 取り込み）は必ずオーナーに確認してから進める。直接 push 自体は Alpha 期は解禁されているが、リモート tag / default branch を動かす操作なので確認を挟む
- **commit は指示待ちせず、作業が一区切りしたタイミングで自発的に行ってよい**（グローバルの「勝手に commit しない」ルールを alpha 期間中はオーバーライドする）
- **push は引き続きオーナーの明示指示があるまで行わない**（commit はローカルで revert 可能だが push はリモートを汚すため）

## Worktree 運用

`samples/` には大きい LFS アセットが含まれるため、AI / Codex が新しい worktree を作る場合は、原則として `samples/` を checkout しない sparse checkout を使う。

### ルール

- worktree 作成時は `--no-checkout` で作成し、sparse checkout 設定後に checkout する
- 通常作業では `samples/` を除外する
- サンプル検証が必要な作業だけ `git sparse-checkout add samples` で明示的に追加する
- 既存 worktree で `samples/` が不要な場合は、未コミット変更を確認してから sparse checkout で除外する

### 推奨コマンド

```powershell
rtk git worktree add --no-checkout F:\Develop\yw-look-wt\<name> -b codex/<name> develop
Set-Location F:\Develop\yw-look-wt\<name>

rtk git sparse-checkout init --cone
rtk git sparse-checkout set .github .husky docs public scripts src src-tauri tests
rtk git checkout
```

`samples/` が必要になった場合のみ追加する。

```powershell
rtk git sparse-checkout add samples
```

## 基本方針

- 常に小さく動く単位で進める
- まとまった変更ごとにコミットする
- 実装だけでなく確認結果も残す
- 大きい変更を 1 コミットに詰め込まない
- 壊れている状態を長く放置しない

## ブランチ運用

`yw-look` は **`develop` 中心の開発フロー** を採用する。`main` は release 用の安定ブランチであり、直接 commit しない。

### ブランチの役割

- **`main`** — release 用。tag が打たれる対象。`develop` からの merge と hotfix のみが入る。
- **`develop`** — 開発の集約ブランチ。**デフォルトブランチ**。すべての機能 PR はここに着地する。
- **`feature/*` / `feat/*` / `fix/*` / `docs/*`** — 短命の作業ブランチ。`develop` から切り、PR で `develop` に戻す。

### ルール

- 機能開発は `develop` から作業ブランチを切る (例: `feat/usd-phase1`)
- 通常の作業ブランチ（`feature/*` / `feat/*` / `fix/*` / `docs/*`）の PR の **base は必ず `develop`** にする。`main` を base にした PR は作らない
- 作業ブランチは merge 後に削除する
- `main` は release 時に `develop` から PR 経由で merge する（直接 push 禁止）
- hotfix は `main` から `hotfix/*` を切り、**例外として** `hotfix/*` → `main` の PR で取り込む
- hotfix を `main` に取り込んだ後は、同じ変更を `develop` にも PR 経由で取り込む

### AI への明示

AI が PR を作成する際は次を必ず守る:

- 通常の作業ブランチでは `gh pr create --base develop ...` を使う
- hotfix の場合のみ `hotfix/*` から `main` への PR を作成してよい。その後、同じ変更を `develop` にも取り込む
- 既存ブランチに対する作業も、`git switch develop && git pull` してから feature ブランチを切り直す
- main ブランチへの直接 push / 直接 commit は行わない

## コミット運用

### 必須ルール

- 機能追加、リファクタ、設定変更、ドキュメント更新は可能な限り分けてコミットする
- 1 コミット 1 意図を基本にする
- 動く状態、または少なくとも意味のある途中状態でコミットする
- コミット前に差分を見直す
- コミット前に不要ファイルが混ざっていないか確認する
- 自動生成物や一時ファイルはコミットしない
- 大きいサンプルやバイナリアセットは `git lfs` 前提で扱う

### コミット前チェック

最低限、以下を確認する。

- 差分が今回の目的に一致しているか
- 無関係な変更が混ざっていないか
- ログやスクリーンショットを意図せず含めていないか
- 設定変更が必要なら理由が説明できるか
- 動作確認または確認不能理由を説明できるか

### 推奨コミット単位

- `setup`: 初期セットアップや依存追加
- `viewer`: ビューアの骨格
- `loader`: フォーマットローダー追加
- `ui`: 表示や操作 UI
- `metadata`: メタデータ / 階層 / テクスチャ一覧
- `perf`: 速度改善や解放処理
- `docs`: 計画書、手順書、運用文書
- `test`: 検証スクリプトやサンプル整備

## コミットメッセージ

### 方針

- 短く、意図が分かるものにする
- 変更結果ではなく変更意図が伝わるようにする
- 曖昧な文言を避ける

### 例

- `setup: initialize tauri + react + vite app`
- `viewer: add base three.js scene and camera`
- `loader: add gltf and fbx loading pipeline`
- `ui: add bottom overlay animation bar`
- `metadata: add hierarchy and texture list panels`
- `perf: dispose textures and materials on file switch`
- `docs: add autonomous debugging workflow`

### 避けるもの

- `fix`
- `update`
- `changes`
- `wip`
- `misc`

文脈がない 1 語だけのコミット名は避ける。

## コミット名レビュー

AI はコミット前に、コミット名が適切かを自分で見直す。

確認観点:

- このコミット名だけで変更の主題が分かるか
- 差分の範囲とコミット名が一致しているか
- 複数の意図を 1 行に押し込んでいないか
- `fix` や `update` のような雑な名前になっていないか

必要ならコミットを分割してから記録する。

## コードレビュー

### レビュワー: Codex CLI

`yw-look` のコードレビューは Codex CLI を標準レビュワーとして使う。Claude Code 上では `codex-review` スキル経由で呼び出す。

運用ルール:

- コミット前に `git diff` を Codex に渡してレビューする
- レビュー対象は「これからコミットする差分」または「直近の特定コミット」
- Codex が指摘した観点は、そのまま採否を判断せず、必要に応じて反論または修正する
- 重大な指摘を無視する場合は理由をコミットメッセージまたは PR 本文に残す

Codex を通すタイミング:

- 機能追加やリファクタの差分が固まったとき
- USD や Three.js のような touchy な領域に触れたとき
- PR を立てる直前

### PR レビュー対応の委任

PR を作成したら、レビューコメントへの対応と CI 修正は **Sonnet サブエージェントに委任する**。

手順:

1. `gh pr create` で PR を作成する
2. Claude Code から `Agent` ツールで Sonnet サブエージェントを起動する
3. サブエージェントに以下を伝える
   - PR 番号と内容の概要
   - ブランチ名とプロジェクトルート
   - commit / push の権限を明示的に付与する旨
   - AGENTS.md のコミット運用ルール（意図単位で分ける、命名規則等）
4. サブエージェントが自律的に CI 確認 → 修正 → commit → push を行う
5. 完了報告を受けて、必要なら追加対応を指示する

委任する範囲:

- CI 失敗の原因調査と修正
- レビューコメントへのコード修正
- 修正後の commit / push

委任しない範囲（本人確認が必要):

- merge 操作
- ブランチ削除
- force push

## レビューしやすい進め方

- まずドキュメントで方針を確定する
- 次に骨格だけを実装する
- その後、フォーマットごとに順番に足す
- UI と内部処理を同時に大きく変えない
- パフォーマンス改善は機能追加コミットと分ける

## 検証と記録

- 検証に使ったサンプルは `samples/manifest.json` で追える状態にする
- スクリーンショットは `artifacts/screenshots/` に出力する
- ログは `artifacts/logs/` に出力する
- コミット時には成果物そのものではなく、再現可能な設定と手順を優先する

## Git LFS

- 3D モデル、HDRI、EXR、圧縮テクスチャなどの重いバイナリは `git lfs` を使う
- 新しい対応拡張子を増やしたら `.gitattributes` を更新する
- サンプル追加時は、通常 Git に載せるべきか `git lfs` に載せるべきかを先に確認する
- 公開できない検証アセットは `samples/private/` に置き、コミットしない

## 参照すべきドキュメント

- `PLAN.md` — プロダクト仕様と設計判断
- `DESIGN.md` — Figma デザインシステムの定義（デザイントークン、コンポーネント仕様、UI ガイドライン）
- `ToDo.md` — 実装チェックリスト

UI に関わる変更を行う場合は、必ず `DESIGN.md` を事前に読み、デザインシステムとの整合性を確認すること。

## AI への期待

AI は作業時に次を守る。

- 実装前に既存方針を確認する
- 変更前に関連ファイルを読む
- UI 変更時は `DESIGN.md` のデザイントークンとコンポーネント仕様に従う
- 大きな変更前に何を触るか明確にする
- 変更後に最低限の確認を行う
- 確認できなかった場合は、その理由を明記する
- コミットするならコミット名の妥当性を見直す

## 将来追加したい運用

- コミットテンプレート
- PR テンプレート
- 検証チェックリスト
- 回帰確認の自動実行
