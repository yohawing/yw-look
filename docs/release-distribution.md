# 配布と更新の運用メモ

このドキュメントは、`yw-look` を Windows / macOS 向けに配布し、GitHub Releases とローカル更新テストを運用するための手順をまとめたものです。

## 目的

このプロジェクトでは次の 2 つを成立させます。

1. GitHub Releases から Windows / macOS 両方を配布できること
2. 開発中のローカル環境で、インストール済みアプリをローカル update feed から更新できること

## 対応状況

| OS      | 開発実行 | バンドル            | 署名                          | updater  | GitHub Releases |
| ------- | -------- | ------------------- | ----------------------------- | -------- | --------------- |
| Windows | 対応済み | NSIS / MSI 対応済み | Authenticode は未整備         | 対応済み | 対応済み        |
| macOS   | 対応済み | DMG / .app 対応済み | Developer ID + 公証（未整備） | 対応済み | 対応済み        |

実装の進捗は `CHANGELOG.md` と、ローカル管理の作業メモ（ルートの `TODO.md` / `ROADMAP.md`、リポジトリには含まれない）を参照してください。

## まず覚えること

公開鍵と秘密鍵の扱いを混同しないことが最重要です。これは Windows / macOS 共通です。

### コミットしてよいもの

- `src-tauri/tauri.conf.json` に入れる updater 公開鍵
- GitHub Releases 用の workflow
- 配布手順やドキュメント

### コミットしてはいけないもの

- 秘密鍵ファイル（minisign / Apple Developer ID 双方）
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE` などの Apple 署名関連 Secrets
- ローカル作業中に作った秘密情報入りメモ

## updater 鍵の形式（Windows / macOS 共通）

このプロジェクトでは、同じ公開鍵でも用途によって入れる形式が違います。  
これは Tauri の updater が minisign 鍵を使うためで、配布対象 OS とは独立しています。

### 1. `tauri.conf.json` に入れる公開鍵

ここには `.pub` ファイルの中身をそのまま入れます。  
つまり、base64 の 1 行文字列です。

例:

```text
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6...
```

### 2. アプリ UI の `Local updater public key` に入れる公開鍵

ここには decode 後の 2 行テキストを入れます。

例:

```text
untrusted comment: minisign public key: XXXXXXXXXXXXXXXX
RWQ...
```

### 3. 秘密鍵

秘密鍵はリポジトリ外に置きます。

例:

```text
Windows: C:\Users\<user>\.tauri\yw-look-dev-pw.key
macOS:   ~/.tauri/yw-look-dev-pw.key
```

## bundle 設定の構造

`src-tauri/tauri.conf.json` の `bundle.targets` と `bundle.icon` は OS 別に分岐させる方針です（実装は ToDo 参照）。

| OS      | targets       | icon              | 出力先                                         |
| ------- | ------------- | ----------------- | ---------------------------------------------- |
| Windows | `nsis`, `msi` | `icons/icon.ico`  | `src-tauri/target/release/bundle/{nsis,msi}/`  |
| macOS   | `app`, `dmg`  | `icons/icon.icns` | `src-tauri/target/release/bundle/{macos,dmg}/` |

実行時の OS で自動的に該当 targets だけが評価されるよう、`tauri.conf.json` 側または `tauri.windows.conf.json` / `tauri.macos.conf.json` のいずれかで分岐を入れます。

## アプリ内更新 UI

アプリ内の `App Updates` カードから次を扱えます（OS 共通）。

- 現在バージョン確認
- update check
- pending update install
- localhost 用 update feed override

---

# リリース前チェックリスト（Alpha 期共通）

タグを push する前に、以下をすべて完了させること。実行不能な項目は理由をコミットメッセージまたは作業ログに残す。

## 1. バージョン番号を更新する

以下のファイルのバージョン文字列を統一する。

- `package.json`
- `package-lock.json`（`npm install --package-lock-only` で自動更新）
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`（`cargo update --workspace` で自動更新）

## 2. CHANGELOG.md を更新する

- `## vX.Y.Z (YYYY-MM-DD)` エントリを先頭に追記する
- `git log <前バージョンタグ>..HEAD --oneline --no-merges` で変更を洗い出す
- 日付は push 当日の日付にする
- [リリースノート契約](#リリースノート契約) の必須フィールドを同じエントリ内に含める
- 公開前に `npm run release:notes -- --tag vX.Y.Z` で GitHub Release body のプレビューを確認する

## 3. ドキュメントを更新する

- `README.md` の対応フォーマット一覧・Optional Loader Pack 表・バッジが最新か確認する
- 新機能・変更に伴い `docs/` 配下の関連ドキュメントを更新する
- 変更なしの場合もその判断を確認したことを記録する

## 4. コード品質を確認する

```bash
npm run check   # lint + format:check + typecheck を一括実行
```

失敗があれば修正してから次に進む。

## 5. リリース smoke を確認する

公開 fixture / sample のアセットカタログを実 loader 経路で確認する。

```bash
npm run test:fixtures -- --timeout-ms 600000
```

結果は次に出力される。

- `artifacts/logs/fixture-regression-report.json`
- `artifacts/logs/fixture-regression-report.md`
- `artifacts/logs/fixture-regression-report.html`

補助的なローカル実機確認として、非配布の `F:\3dcg` アセットから 100 件に絞った
ロード / 目視レビューも 2026-06-30 に実施済み。`--check` は 100 件すべて pass
（warning / fail なし）。スクリーンショット付き visual review は 97 モデル中
95 rendered / 1 blank / 1 missing、診断は Issues 2 / Warnings 1 / Errors 1 /
Logs 0、解像度は 640x480。これはライセンス上ローカル証跡のみで、アセットや
スクリーンショット自体は release artifact に含めない。

## 6. macOS ビルドを確認する

macOS ビルドが通ることを確認してからタグを打つ。

- **CI で確認する場合**: `develop` への push 後、CI の macOS ジョブが成功していることを確認する
- **ローカルで確認する場合**: `npm run bundle:mac` が成功することを確認する
- **確認できない場合**: release note または作業ログに「macOS 未確認」と理由を明記する

## 7. develop に commit・push する

バージョン bump・CHANGELOG・ドキュメント更新をまとめて commit し、`develop` に push する。push はオーナーの明示指示後に行う。

## 8. main を develop に FF する

```bash
git checkout main
git merge --ff-only develop
```

タグ前に `git status` で main が develop と同一 commit であることを確認する。

## 9. タグを打ち、オーナー確認後に push する

```bash
git tag vX.Y.Z
# オーナー確認後:
git push origin main && git push origin vX.Y.Z
```

タグ push により `release.yml` が自動起動し、Windows / macOS ビルドが並列実行される。

---

# リリースノート契約

GitHub Release の本文は `CHANGELOG.md` を唯一のソースとする。`release.yml` はタグ push 時に `scripts/extract-release-notes.mjs` で該当セクションを抽出し、`tauri-apps/tauri-action` の `releaseBody` に渡す。マッチする見出しが無い場合は workflow が失敗し、汎用文だけの Release は公開されない。

## 抽出コマンド

```bash
# stdout に GitHub Release body 相当を出力
npm run release:notes -- --tag v0.2.2

# ファイルへ書き出し（CI と同じ）
npm run release:notes -- --tag v0.2.2 --output release-body.md
```

抽出対象は `CHANGELOG.md` 先頭付近の `## vX.Y.Z (YYYY-MM-DD)` 見出し直下から、次の `##` 見出し直前まで。Release タイトル（`yw-look vX.Y.Z`）と重複するため、見出し行自体は body に含めない。

## 必須フィールド

各バージョンの `CHANGELOG.md` エントリには、製品変更のほか、監査可能な配布確認結果を必ず含める。未実施の項目は「未確認（not verified）」と明記し、理由を 1 行以上書く。省略や空欄は不可。

### Known limitations

- 当該リリースでユーザーに影響する既知の制限、未対応フォーマット、回避策を列挙する
- 例: Optional Loader Pack 未選択時の制限、bundle identifier 変更による共存、特定 GPU での既知不具合

### Windows signing and SmartScreen

- Authenticode 署名の有無と検証コマンド結果（例: `Get-AuthenticodeSignature` の `Status`）
- SmartScreen の挙動（警告なし / 警告ありと対策 / 未検証）または未検証理由
- 対象 artifact 名（通常は NSIS `setup.exe` と updater 用 `.exe`）

### macOS codesign, notarization, and Gatekeeper

- `codesign -dv` または同等手段での Developer ID 署名確認結果
- `notarytool` 公証と `stapler validate` の結果
- 実機での Gatekeeper（初回起動・quarantine なし）と Finder `Open With` の結果、または未検証理由
- 対象 artifact 名（`.app` / `.dmg` / updater `.tar.gz`）

### GitHub Release install and updater roundtrip

- Windows: Release の `setup.exe`（または公開インストーラー）からの新規インストール → 旧版から `latest.json` 経由の更新が成功したか
- macOS: Release の `.dmg` または `.app` からの新規インストール → 旧版から `latest.json` 経由の更新が成功したか
- 使用した旧版タグ、更新先タグ、`App Updates` で確認した endpoint、失敗時はログまたは再現手順
- 実施できない場合は OS ごとに「未確認（not verified）」と理由を書く

## 推奨テンプレート

`CHANGELOG.md` エントリ末尾に次の見出しを置くと、契約を満たしやすい。

```markdown
### Known limitations

- ...

### Distribution verification

#### Windows signing and SmartScreen

- Status: verified | not verified
- Details: ...

#### macOS codesign, notarization, and Gatekeeper

- Status: verified | not verified
- Details: ...

#### GitHub Release install and updater roundtrip

- Windows: verified | not verified — ...
- macOS: verified | not verified — ...
```

---

# Windows 配布

## GitHub Releases 配布フロー（Windows）

### 1. 公開鍵を `tauri.conf.json` に入れる

`src-tauri/tauri.conf.json` の `plugins.updater.pubkey` には、`.pub` ファイルの中身をそのまま入れます。

注意:

- decode 後の 2 行テキストではありません
- `.pub` ファイルに保存されている base64 の 1 行を入れます

### 2. GitHub Secrets を設定する

GitHub Actions では次を設定します。

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`

補足:

- `TAURI_UPDATER_PUBLIC_KEY` は workflow 用の参照値です
- アプリ本体は `tauri.conf.json` に入っている公開鍵を使います

### 3. バージョンを更新する

最低限、リリース対象のバージョンを更新します。

更新対象:

- `package.json`
- `package-lock.json` (`npm install --package-lock-only` で自動更新)
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (`cargo update --workspace` で自動更新)
- `src-tauri/tauri.conf.json`

### 4. CHANGELOG を更新する

`CHANGELOG.md` に今回のリリース内容を追記します。英語で記述してください。[リリースノート契約](#リリースノート契約) の必須フィールドも同じエントリに含めます。

### 5. タグを push する

例:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

### 6. GitHub Actions で Release を作る

workflow が Windows bundle をビルドし、GitHub Release に成果物を添付します。

想定成果物:

- `setup.exe`
- `.msi`
- updater 用 artifact
- `latest.json`

## NSIS Loader Pack 実機確認（Windows）

v0.3 では Windows NSIS インストーラーに Optional Loader Pack の選択ページを含める。
リリース前に loaders overlay 付き bundle を作成し、MMD / Gaussian Splatting の初期
インストール選択が実際に反映されることを確認する。

事前の静的確認:

```powershell
npm run check:nsis-loader-packs
```

bundle 作成:

```powershell
npm run bundle:win:loaders
```

確認対象:

1. `src-tauri/target/release/bundle/nsis/` に `setup.exe` が生成されること
2. 対話インストールで Optional Loader Packs ページが表示されること
3. MMD / Gaussian Splatting の checkbox が表示されること
4. 両方 ON でインストールした後、次の manifest が存在すること

```powershell
Test-Path "$env:APPDATA\com.yohawing.ywlook\optional-loaders\mmd\manifest.json"
Test-Path "$env:APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat\manifest.json"
```

5. 両方 OFF で再インストールした後、manifest が削除され、各 pack directory に
   `.removed` marker が残ること

```powershell
Test-Path "$env:APPDATA\com.yohawing.ywlook\optional-loaders\mmd\.removed"
Test-Path "$env:APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat\.removed"
```

補足:

- `src-tauri/tauri.windows.loaders.json` は NSIS hook を有効化する overlay である。
- GitHub Release workflow の Windows build もこの overlay を使う。
- サイレントインストールと updater の `/P` 経路では pack 選択ページを表示しない。

## ローカル更新テストフロー（Windows）

これは開発中だけ使う手順です。

### 1. パスワード付き開発鍵を作る

パスワードなし鍵より、明示的にパスワード付きにしたほうが混乱が少ないです。

例:

```powershell
npm run tauri signer generate -- -w $env:USERPROFILE\.tauri\yw-look-dev-pw.key -p dev-local-pass -f
```

生成されるファイル:

- 秘密鍵: `C:\Users\<user>\.tauri\yw-look-dev-pw.key`
- 公開鍵: `C:\Users\<user>\.tauri\yw-look-dev-pw.key.pub`

### 2. `tauri.conf.json` に公開鍵を入れる

`.pub` ファイルの中身をそのまま `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に設定します。

### 3. 署名付き bundle を作る

PowerShell で次を実行します。

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $env:USERPROFILE\.tauri\yw-look-dev-pw.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "dev-local-pass"
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
npm run bundle:win
```

出力先:

- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

### 4. ローカル update feed を作る

```powershell
npm run update:local:prepare
```

出力先:

- `artifacts/updater-feed/latest.json`
- `artifacts/updater-feed/<installer>`
- `artifacts/updater-feed/<installer>.sig`

### 5. ローカル update feed を配信する

```powershell
npm run update:local:serve
```

既定 URL:

```text
http://127.0.0.1:8765/latest.json
```

### 6. アプリ側で localhost feed を設定する

アプリの `App Updates` カードで以下を入力します。

- `Local update feed URL`
  - `http://127.0.0.1:8765/latest.json`
- `Local updater public key`
  - decode 後の 2 行公開鍵
- `Allow local HTTP update feed on localhost only`
  - ON

その後:

1. `Save Update Settings`
2. `Check for Updates`
3. 更新が見つかったら `Install Update`

## 公開鍵を decode する方法（Windows）

アプリ UI に貼る 2 行形式の公開鍵が必要なときは、次を使います。

```powershell
$encoded = Get-Content $env:USERPROFILE\.tauri\yw-look-dev-pw.key.pub -Raw
[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encoded))
```

出力される 2 行を `Local updater public key` に貼ります。

---

# macOS 配布

macOS の bundle / release job / local update feed 導線は整備済みです。
未完了なのは Apple Developer ID 証明書を使った本番署名・公証と、実機での
Finder / Gatekeeper / updater 往復確認です。

## 必要なもの（macOS）

- Apple Developer Program のメンバーシップ（年会費）
- Developer ID Application 証明書（`.p12` 形式に書き出したもの）
- App-specific password（公証用、Apple ID から発行）
- Team ID
- minisign 鍵ペア（Windows と共通の updater 鍵を流用してよい）

## 鍵と証明書の置き場所

```text
~/.tauri/yw-look-dev-pw.key            # updater 秘密鍵（minisign）
~/.tauri/yw-look-dev-pw.key.pub        # updater 公開鍵（minisign）
~/.private/yw-look-developer-id.p12    # Apple Developer ID 証明書
```

`.p12` はリポジトリ外に置き、GitHub Secrets には base64 文字列で投入します。

## GitHub Releases 配布フロー（macOS）

### 1. updater 鍵は Windows と共通

`tauri.conf.json` の `plugins.updater.pubkey` は OS で分けません。同じ minisign 公開鍵を Windows / macOS 双方の updater が使います。

### 2. GitHub Secrets を設定する（macOS 追加分）

Windows 用の Secrets に加えて、次を追加します。

- `APPLE_CERTIFICATE` — `.p12` を base64 化したもの
- `APPLE_CERTIFICATE_PASSWORD` — `.p12` のパスワード
- `APPLE_SIGNING_IDENTITY` — 例: `Developer ID Application: Your Name (TEAMID)`
- `APPLE_ID` — Apple ID メールアドレス
- `APPLE_PASSWORD` — App-specific password（通常のログインパスワードではない）
- `APPLE_TEAM_ID` — Apple Developer Team ID

これらは Tauri 公式の macOS 署名・公証フロー用に予約された環境変数名です。
tag release の macOS job は、これらの Secrets が 1 つでも欠けている場合に
build 前に失敗します。未署名または ad-hoc 署名の macOS artifact を GitHub
Release に載せないためです。

### 3. bundle 設定を確認する

`tauri.conf.json` は `bundle.targets = "all"` と OS 別 icon を含みます。
macOS の C++ backend 配布では `tauri.macos.json` overlay を併用し、
OpenUSD dylib を `Contents/Frameworks/`、plugin tree を
`Contents/Resources/usd/` に含めます。

`bundle.macOS.signingIdentity` は通常設定しません。CI では
`APPLE_CERTIFICATE` から import された Developer ID 証明書を Tauri が推論します。
ローカル build で ad-hoc 署名を試す場合だけ、一時 overlay で
`signingIdentity = "-"` を指定します。

`plugins.updater.windows.installMode` は Windows 専用設定です。macOS updater
には同等の install mode 設定はありません。

### 4. バージョンを更新する

Windows と同じく全バージョンファイルを更新します（Windows 側ステップ 3 参照）。

### 5. CHANGELOG を更新する

Windows 側ステップ 4 と同じ。`CHANGELOG.md` に英語でリリース内容を追記し、[リリースノート契約](#リリースノート契約) の必須フィールドを含めます。

### 6. タグを push して Actions を走らせる

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions の release workflow が Windows と macOS のジョブを並列実行します。
Tauri Action は前述の Secrets が揃っていれば codesign と公証を実行します。

### 想定成果物（macOS）

- `yw-look_<version>_aarch64.dmg`
- `yw-look.app.tar.gz`（updater 用）
- `yw-look.app.tar.gz.sig`（minisign 署名）
- `latest.json`（Windows と統合）

`latest.json` の `platforms` には次のキーが並びます。

```json
{
  "platforms": {
    "windows-x86_64": { "...": "..." },
    "darwin-aarch64": { "...": "..." }
  }
}
```

## ローカル更新テストフロー（macOS）

公証は不要です。codesign すら省略できます（ローカル配信限定なら）。

### 1. updater 用の minisign 鍵を作る

```bash
npm run tauri signer generate -- -w ~/.tauri/yw-look-dev-pw.key -p dev-local-pass -f
```

生成物:

- 秘密鍵: `~/.tauri/yw-look-dev-pw.key`
- 公開鍵: `~/.tauri/yw-look-dev-pw.key.pub`

### 2. `tauri.conf.json` に公開鍵を入れる

`.pub` ファイルの中身そのままの base64 1 行を `plugins.updater.pubkey` に設定します。

### 3. 署名付き bundle を作る

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/yw-look-dev-pw.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="dev-local-pass"
unset TAURI_SIGNING_PRIVATE_KEY_PATH
npm run bundle:mac
```

出力先:

- `src-tauri/target/release/bundle/macos/yw-look.app`
- `src-tauri/target/release/bundle/macos/yw-look.app.tar.gz`
- `src-tauri/target/release/bundle/macos/yw-look.app.tar.gz.sig`
- `src-tauri/target/release/bundle/dmg/yw-look_<version>_aarch64.dmg`

### 4. ローカル update feed を作る

```bash
npm run update:local:prepare
```

`prepare-local-update-feed.mjs` は OS 別に成果物を探します。macOS では
`.app.tar.gz` と `.app.tar.gz.sig` を拾い、`platforms.darwin-x86_64` または
`platforms.darwin-aarch64` を生成します。公開 release では Apple Silicon
macOS のみを対象にするため、通常は `platforms.darwin-aarch64` だけを確認します。

### 5. ローカル update feed を配信する

```bash
npm run update:local:serve
```

### 6. アプリ側で localhost feed を設定する

Windows と同じ手順です。

## 公開鍵を decode する方法（macOS）

```bash
base64 --decode < ~/.tauri/yw-look-dev-pw.key.pub
```

## codesign と公証（本番配布のみ）

ローカル配信では不要です。本番配布フローで Tauri Action に任せる場合、開発者が手で叩く必要は基本ありません。手動で確認したい場合の参考コマンドは次のとおりです。

```bash
# 署名状態の確認
codesign -dv --verbose=4 src-tauri/target/release/bundle/macos/yw-look.app

# 公証チケットがアプリにステープルされているか確認
xcrun stapler validate src-tauri/target/release/bundle/macos/yw-look.app

# 公証ジョブ履歴の確認
xcrun notarytool history --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD"
```

## Finder 連携の確認

`tauri.conf.json` の `bundle.fileAssociations` は macOS bundle では
`CFBundleDocumentTypes` に変換されます。実機で次を確認します。

1. GitHub Release または local bundle から `yw-look.app` を `/Applications` に配置する
2. `.glb` / `.usda` / `.png` など対象拡張子のファイルを Finder で選ぶ
3. `Open With` に `yw-look` が表示されることを確認する
4. ファイルを開いたとき、アプリ起動後に対象ファイルが preview されることを確認する

---

# よくあるハマりどころ

## `Missing comment in public key`

原因:

- `tauri.conf.json` の `plugins.updater.pubkey` に、decode 後の 2 行を入れている
- あるいは空文字のまま

対処:

- `.pub` ファイルの中身そのままの base64 1 行を入れる

## `Wrong password for that key`

原因:

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` が鍵の実際のパスワードと一致していない
- 古い環境変数が残っている

対処（Windows）:

```powershell
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content <秘密鍵> -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<正しいパスワード>"
```

対処（macOS）:

```bash
unset TAURI_SIGNING_PRIVATE_KEY_PATH
export TAURI_SIGNING_PRIVATE_KEY="$(cat <秘密鍵>)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<正しいパスワード>"
```

## アプリ UI 側の公開鍵で更新確認に失敗する

原因:

- UI に `.pub` ファイルそのままの base64 1 行を貼っている

対処:

- decode 後の 2 行を貼る

## `bundle identifier ... ends with .app`

identifier は `com.yohawing.ywlook` を使用します。`.app` で終わる識別子は **macOS 配布で実害が出る可能性が高い** ため、初期設定の `com.ywlook.app` から変更済みです。

既存 Windows インストーラーがインストールされている環境では、identifier 変更により上書きアップデートが効かず別アプリとして共存する可能性があるため、リリースノートで明示してください。

## macOS で「開発元を検証できません」と出る（ローカル配布時）

公証していない `.app` を直接実行した場合に出ます。ローカル検証時の対処:

```bash
xattr -dr com.apple.quarantine src-tauri/target/release/bundle/macos/yw-look.app
```

本番配布では codesign と公証を済ませることで回避します。

## macOS ローカル DMG 作成で Finder AppleScript がタイムアウトする

`npm run bundle:mac` の Rust/Tauri build、`.app` bundle、updater 用
`yw-look.app.tar.gz` / `.sig` 生成までは成功しているのに、最後の DMG 作成だけが
`Finderでエラーが起きました: AppleEventがタイムアウトしました。 (-1712)` で失敗することがあります。

これは Tauri bundler が DMG 内のアイコン配置を Finder AppleScript で整える段階の失敗です。
ローカル検証では、次が確認できていれば updater artifact の確認として扱えます。

- `src-tauri/target/release/bundle/macos/yw-look.app`
- `src-tauri/target/release/bundle/macos/yw-look.app.tar.gz`
- `src-tauri/target/release/bundle/macos/yw-look.app.tar.gz.sig`
- `npm run update:local:prepare` が `platforms.darwin-aarch64` を生成すること

公開リリースでは GitHub Actions の macOS release job を正とし、DMG artifact と
`latest.json` の `darwin-aarch64` entry が揃うことを確認してください。

# 追加で残っていること

実装上の配布導線は Windows / macOS ともに揃っています。配布品質としては
まだ次が残っています。

## Windows

- Windows Authenticode 署名
- SmartScreen 対策
- リリースノート契約どおりの署名 / updater 確認結果を `CHANGELOG.md` に記載する（抽出 workflow は整備済み）
- 実際の GitHub Release 往復確認

## macOS

- Apple Developer ID 証明書の調達
- Apple 署名・公証 Secrets の実リリース検証（Secrets 登録自体は 2026-05-07 に確認済み）
- codesign / notarytool / stapler の実リリース確認
- Finder の `Open With` / 関連付け確認
- GitHub Release artifact からの実インストール確認
- updater feed の macOS artifact からの実更新確認

## 最低限の確認コマンド

Windows:

```powershell
npm run lint
npm run typecheck
npm run bundle:win
npm run update:local:prepare
npm run update:local:serve
```

macOS:

```bash
npm run lint
npm run typecheck
npm run bundle:mac
npm run update:local:prepare
npm run update:local:serve
```

## 運用方針

- 公開鍵は repo に入れてよい
- 秘密鍵は必ず repo 外（minisign / Apple Developer ID 双方）
- GitHub では秘密鍵とパスワードを Secrets 管理
- ローカル更新は localhost 限定で使う
- 本番配布は GitHub Releases を正とする
- Windows と macOS は同じバージョン番号で同時リリースする
