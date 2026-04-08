# 配布と更新の運用メモ

このドキュメントは、`yw-look` を Windows / macOS 向けに配布し、GitHub Releases とローカル更新テストを運用するための手順をまとめたものです。

## 目的

このプロジェクトでは次の 2 つを成立させます。

1. GitHub Releases から Windows / macOS 両方を配布できること
2. 開発中のローカル環境で、インストール済みアプリをローカル update feed から更新できること

## 対応状況

| OS      | 開発実行 | バンドル             | 署名                          | updater  | GitHub Releases |
| ------- | -------- | -------------------- | ----------------------------- | -------- | --------------- |
| Windows | 対応済み | NSIS / MSI 対応済み  | Authenticode は未整備         | 対応済み | 対応済み        |
| macOS   | 対応中   | DMG / .app（実装中） | Developer ID + 公証（未整備） | 設計中   | 未整備          |

実装の進捗は `ToDo.md` の「OS 統合（Windows / macOS）」と「CI/CD 整備」セクションを参照してください。

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
- `src-tauri/tauri.conf.json`
- 必要なら他の表示用バージョン

### 4. タグを push する

例:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

### 5. GitHub Actions で Release を作る

workflow が Windows bundle をビルドし、GitHub Release に成果物を添付します。

想定成果物:

- `setup.exe`
- `.msi`
- updater 用 artifact
- `latest.json`

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

# macOS 配布（想定手順・実装中）

このセクションはまだ実装されていない手順を含みます。実装の進捗に合わせて差分を反映してください。最終確定までは「想定手順」として読んでください。

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

### 3. アイコンを用意する

`src-tauri/icons/icon.icns` を生成し、`tauri.conf.json` の OS 別 `bundle.icon` に登録します。`.icns` 生成は `iconutil` または Tauri CLI の `tauri icon` から行えます。

### 4. バージョンを更新する

Windows と同じく `package.json` と `src-tauri/tauri.conf.json` を更新します。

### 5. タグを push して Actions を走らせる

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions の release workflow に `macos-latest` ランナーを追加し、Windows と macOS のジョブが並列で動くようにします。Tauri Action は前述の Secrets が揃っていれば codesign と公証を自動で実行します。

### 想定成果物（macOS）

- `yw-look_<version>_x64.dmg`
- `yw-look_<version>_aarch64.dmg`
- `yw-look.app.tar.gz`（updater 用）
- `yw-look.app.tar.gz.sig`（minisign 署名）
- `latest.json`（Windows と統合）

`latest.json` の `platforms` には次のキーが並びます。

```json
{
  "platforms": {
    "windows-x86_64": { "...": "..." },
    "darwin-x86_64": { "...": "..." },
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
- `src-tauri/target/release/bundle/dmg/yw-look_<version>_x64.dmg`

### 4. ローカル update feed を作る

```bash
npm run update:local:prepare
```

`prepare-local-update-feed.mjs` は OS 別に成果物を探す前提で作り直します（ToDo 参照）。macOS では `.app.tar.gz` と `.app.tar.gz.sig` を拾い、`platforms.darwin-x86_64` または `platforms.darwin-aarch64` を生成します。

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

# 追加で残っていること

今の実装で Windows updater は成立しますが、配布品質としてはまだ次が残っています。

## Windows

- Windows Authenticode 署名
- SmartScreen 対策
- リリースノート整備
- バージョン更新の手順固定化
- 実際の GitHub Release 往復確認

## macOS

- `tauri.conf.json` の OS 別 bundle 設定分岐
- `.icns` アイコン生成
- `bundle:mac` npm script の追加
- `prepare-local-update-feed.mjs` の OS 別対応
- Apple Developer ID 証明書の調達
- GitHub Actions に `macos-latest` ジョブ追加
- 公証フローの実機確認

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
