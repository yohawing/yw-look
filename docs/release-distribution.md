# 配布と更新の運用メモ

このドキュメントは、`yw-look` を Windows 向けに配布し、GitHub Releases とローカル更新テストを運用するための手順をまとめたものです。

## 目的

このプロジェクトでは次の 2 つを成立させます。

1. GitHub Releases から配布できること
2. 開発中のローカル環境で、インストール済みアプリをローカル update feed から更新できること

## まず覚えること

公開鍵と秘密鍵の扱いを混同しないことが最重要です。

### コミットしてよいもの

- `src-tauri/tauri.conf.json` に入れる updater 公開鍵
- GitHub Releases 用の workflow
- 配布手順やドキュメント

### コミットしてはいけないもの

- 秘密鍵ファイル
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- ローカル作業中に作った秘密情報入りメモ

## 鍵の形式

このプロジェクトでは、同じ公開鍵でも用途によって入れる形式が違います。

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
C:\Users\<user>\.tauri\yw-look-dev-pw.key
```

## 現在の構成

### 配布関連

- Windows installer 出力: `nsis` と `msi`
- updater artifact 生成: 有効
- GitHub Actions workflow: `.github/workflows/release.yml`

### アプリ内更新 UI

アプリ内の `App Updates` カードから次を扱えます。

- 現在バージョン確認
- update check
- pending update install
- localhost 用 update feed override

## GitHub Releases 配布フロー

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

## ローカル更新テストフロー

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

## 公開鍵を decode する方法

アプリ UI に貼る 2 行形式の公開鍵が必要なときは、次を使います。

```powershell
$encoded = Get-Content $env:USERPROFILE\.tauri\yw-look-dev-pw.key.pub -Raw
[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encoded))
```

出力される 2 行を `Local updater public key` に貼ります。

## よくあるハマりどころ

### `Missing comment in public key`

原因:

- `tauri.conf.json` の `plugins.updater.pubkey` に、decode 後の 2 行を入れている
- あるいは空文字のまま

対処:

- `.pub` ファイルの中身そのままの base64 1 行を入れる

### `Wrong password for that key`

原因:

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` が鍵の実際のパスワードと一致していない
- 古い環境変数が残っている

対処:

```powershell
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content <秘密鍵> -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<正しいパスワード>"
```

### アプリ UI 側の公開鍵で更新確認に失敗する

原因:

- UI に `.pub` ファイルそのままの base64 1 行を貼っている

対処:

- decode 後の 2 行を貼る

### `bundle identifier ... ends with .app`

現状の identifier は `com.ywlook.app` ですが、`.app` で終わる識別子は将来的に変更した方が安全です。

候補:

- `com.ywlook.viewer`
- `com.ywlook.desktop`

## 追加で残っていること

今の実装で updater 自体は成立しますが、配布品質としてはまだ次が残っています。

- Windows Authenticode 署名
- SmartScreen 対策
- リリースノート整備
- バージョン更新の手順固定化
- 実際の GitHub Release 往復確認

## 最低限の確認コマンド

```powershell
npm run lint
npm run typecheck
npm run bundle:win
npm run update:local:prepare
npm run update:local:serve
```

## 運用方針

- 公開鍵は repo に入れてよい
- 秘密鍵は必ず repo 外
- GitHub では秘密鍵とパスワードを Secrets 管理
- ローカル更新は localhost 限定で使う
- 本番配布は GitHub Releases を正とする
