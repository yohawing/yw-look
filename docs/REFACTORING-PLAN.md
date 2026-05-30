# yw-look リファクタリング計画

> 作成: 2026-05-28
>
> この計画はプロジェクトの健全性を維持しながら、段階的にコードベースを改善するためのロードマップです。
> 各フェーズは独立して実施可能で、優先度順に並んでいます。

## 現状サマリ

| 指標           | 値                           | 備考                       |
| -------------- | ---------------------------- | -------------------------- |
| フロントエンド | React 19 + Three.js + Vite 7 | TypeScript 5.9             |
| バックエンド   | Tauri 2.8 (Rust)             | 2つのUSDバックエンド       |
| App.tsx        | **~2,747行**                 | 最大のリファクタリング対象 |
| lib.rs         | **~2,458行**                 | Rust側の最大ファイル       |
| テスト数       | 231 test cases               | フロント134 + Rust 97      |
| ドキュメント   | 13ファイル                   | TODO.mdが重複              |

---

## Phase 1: 巨大ファイルの分割（優先: 最高）

### 1.1 App.tsx の分解

**問題**: App.tsx が 2,747行。状態管理、IPC呼び出し、UIレイアウト、コールバックがすべて混在している。

**方針**: 関心ごとにカスタムフックとコンテキストに抽出する。

| 抽出先                              | 責務                                       | 想定行数 |
| ----------------------------------- | ------------------------------------------ | -------- |
| `src/hooks/useAppState.ts`          | ファイル状態、ビューワ状態、設定の一元管理 | ~300     |
| `src/hooks/useFileOps.ts`           | ファイルオープン、ドロップ、履歴           | ~200     |
| `src/hooks/useViewerSync.ts`        | ビューワへのIPC橋渡し                      | ~200     |
| `src/hooks/useKeyboardShortcuts.ts` | キーボードショートカット                   | ~100     |
| `src/hooks/useUpdater.ts`           | アップデート確認                           | ~80      |
| `src/contexts/AppContext.tsx`       | 状態のReact Context提供                    | ~150     |
| `src/layout/AppLayout.tsx`          | サイドバー＋ビューポートのレイアウト構成   | ~200     |
| `src/layout/SidebarPanel.tsx`       | サイドバーのパネル切り替え                 | ~150     |

**目標**: App.tsx を ~500行以下にし、レイアウトとグルーのみにする。

### 1.2 lib.rs の分解

**問題**: 2,458行。ファイル操作、設定、アップデータ、USDコマンド、診断、メニューがすべて1ファイル。

**方針**: Tauriコマンドをドメイン別モジュールに分割。

| モジュール                 | 責務                                             |
| -------------------------- | ------------------------------------------------ |
| `commands/files.rs`        | ファイル一覧、開く、ドロップ、最近使ったファイル |
| `commands/settings.rs`     | 設定の読み書き                                   |
| `commands/diagnostics.rs`  | 診断ログ、システム情報                           |
| `commands/usd.rs`          | USD inspection/export コマンド                   |
| `commands/updater.rs`      | アップデート確認・インストール                   |
| `commands/alembic.rs`      | Alembic変換                                      |
| `commands/integrations.rs` | 外部連携                                         |
| `commands/menu.rs`         | メニューイベント                                 |
| `state.rs`                 | アプリ状態 (Arc<Mutex<...>>) の定義              |

**目標**: lib.rs をモジュール宣言＋セットアップのみにする (~100行)。

---

## Phase 2: 状態管理の整理（優先: 高）

### 2.1 App.tsx の状態を Context + useReducer / zustand に移行

**現状**: すべての状態が App.tsx 内の `useState` で管理され、props で子コンポーネントに渡されている。サイドバーの各カードが props を受け取るパターンが一貫していない。

**選択肢**:

1. **React Context + useReducer** — 追加依存なし。現状の設計に最も近い。
2. **zustand** — 軽量、バケツリレー不要。App.tsx が Context でラップする必要がない。

**推奨**: zustand (多くのTauriアプリで採用実績、不要な再レンダリングを抑制しやすい)

**移行手順**:

1. 状態の型定義を `src/types/store.ts` に集約
2. Viewer状態、UI状態、ファイル状態を分割ストアに
3. 既存 props から段階的に差し替え

### 2.2 AppContext が肥大化しない設計

Context に詰め込みすぎない。以下のように分割:

```typescript
// ドメイン単位で分割
useFileStore — カレントファイル、最近使ったファイル、ブラウジング
useViewerStore — カメラ、表示モード、背景、環境
useUiStore — サイドバータブ、パネル開閉状態
useSettingsStore — 永続化設定
```

---

## Phase 3: CSS / デザインシステムの整理（優先: 中）

### 3.1 現状

- `src/styles/design-system.css` — デザイントークン (OK)
- `src/styles/sidebar.css` — サイドバー専用
- `src/styles/toolbar-popover.css` — ツールバー専用
- `src/styles/viewport.css` — ビューポート専用
- `src/styles.css` — グローバル (一部重複の可能性)

### 3.2 方針

1. `design-system.css` を唯一のトークン定義にする
2. 各コンポーネントのスタイルを CSS Modules または Vanilla Extract に移行検討
3. CSS クラス名に BEM またはコンポーネント名プリフィックスを統一
4. 未使用CSSの削除 (Chrome DevTools Coverage または PurgeCSS)

**目標**: CSSの重複をなくし、トークン参照のみで一貫したテーマ変更を可能にする。

---

## Phase 4: 型の一元管理（優先: 中）

### 4.1 現状問題

- `src/types/` には `.d.ts` が2つだけ
- 多くの型がコンポーネントファイル内で定義されている
- フロントエンドとRust間のwire typeの整合性がドキュメントベース

### 4.2 方針

1. `src/types/` を拡充:
   - `src/types/viewer.ts` — ビューワ設定・状態型
   - `src/types/file.ts` — ファイル・メタデータ型
   - `src/types/ipc.ts` — Tauri IPC リクエスト/レスポンス型
   - `src/types/ui.ts` — UI状態型
2. Rust側の wire type (`src-tauri/src/usd/types.rs`) と naming convention を合わせる
3. `ts-rs` (https://github.com/Aleph-Alpha/ts-rs) 導入を検討:
   Rust構造体に `#[derive(TS)]` を付けると TypeScript 型定義を自動生成できる。
   Tauriのinvoke呼び出しの型安全性が大幅向上する。

---

## Phase 5: エラーハンドリング統一（優先: 中）

### 5.1 現状

- Rust側: `Result<T, UsdError>` / `Result<T, String>` が混在
- フロントエンド側: try/catch の有無がばらつく

### 5.2 方針

1. Rust: すべてのコマンドが `Result<T, String>` ではなく `Result<T, AppError>` を返すようにする
   - `AppError` を `thiserror` で定義し、`Into<tauri::InvokeError>` を実装
   - エラーの種類: `Io`, `Usd`, `Serde`, `Timeout`, `Internal`
2. フロントエンド: IPC呼び出しをラップする `invokeSafe<T>` ユーティリティを作成
   - エラーをユーザー表示可能な形式に変換
   - 診断ログへの自動記録

---

## Phase 6: テスト拡充（優先: 低〜中）

### 6.1 カバレッジの穴

- Rust: `lib.rs` のコマンド関数のユニットテストが不足
- フロントエンド: エラー状態のレンダリングテストが不足
- 統合テスト: エラーケースのテストが少ない

### 6.2 方針

1. Rustコマンドのユニットテスト追加（特に settings, recent_files, diagnostics）
2. React Testing Library でエラー表示・ローディング・空状態のテスト追加
3. Playwright selftest に異常系シナリオ追加

---

## Phase 7: ビルド・CI 最適化（優先: 低）

### 7.1 現状

- ESLint 9 + Prettier で lint-staged 構成済み
- CI に 3 つのワークフロー (lint, C++ backend, release)
- C++ backend のビルドが vcpkg 経由で重い

### 7.2 方針

1. ESLint ルールの見直し（不要な抑制コメントを減らす）
2. Rustの `check-fast` エイリアスをCIに活用する
3. C++ backend CI のキャッシュ戦略改善
4. TypeScript の `paths` エイリアス導入検討 (`@/components/*` など)

---

## Phase 8: 小さな改善（随時）

- `docs/TODO.md` の重複解消（ルートの TODO.md は削除 or シンボリックリンク）
- AGENTS.md のセクション `### 避けるもの` に `refactor` を追加（雑なコミット名撲滅）
- Prettier の `--cache` 有効化
- unused exports の自動検出 (ESLint `no-unused-vars` + `unused-imports` plugin)
- Rust の `clippy` 警告一掃

---

## 実施順序サマリ

```
Phase 1 ───────────────────────────────────────────────┐
├── 1.1 App.tsx の分解                                 │ ← 最高優先
├── 1.2 lib.rs の分解                                  │
Phase 2 ── 状態管理の整理 ─────────────────────────────┤
Phase 3 ── CSS/デザインシステム整理 ────────────────────┤
Phase 4 ── 型の一元管理 ───────────────────────────────┤
Phase 5 ── エラーハンドリング統一 ──────────────────────┤
Phase 6 ── テスト拡充 ─────────────────────────────────┤
Phase 7 ── ビルド/CI最適化 ────────────────────────────┤
Phase 8 ── 小さな改善（随時） ──────────────────────────┘
```

各 Phase は独立しているが、Phase 1 → 2 は密接に関連するため、連続して実施することが望ましい。
Phase 3-8 は Phase 1-2 と並行して進めても問題ない。

---

## 各 Phase 実施時のルール

1. リファクタリング前に該当ファイルのテストカバレッジを確認する
2. 1 コミットで 1 つの抽出/分割のみ行う
3. 抽出後は `npm run check` (lint + typecheck) が通ることを確認する
4. 抽出前後で `npm run test` が同一結果であることを確認する
5. コミット名は `refactor: <unit>` の形式に統一する（例: `refactor: extract useFileStore hook from App.tsx`）
6. Phase 完了ごとにこの計画ファイルに進捗を記録する（後述の進捗テーブルを更新）

---

## 進捗

| Phase                | 状態 | 完了日     | 備考                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 App.tsx 分割     | 🟢   | 2026-05-28 | usePerformanceTracker, useUpdater, useUsdInspector, usePayloadSession, useDeferredData, useKeyboardShortcuts を抽出。2,747→1,792行 (-955, -35%)                                                                                                                                                                                                                                                     |
| 1.2 lib.rs 分割      | 🟢   | 2026-05-29 | lib.rs 2,458→178行 (-92.8%)。commands/ (files/settings/diagnostics/usd/updater/alembic/integrations/bench/shot), state.rs, shared.rs に分割。cargo check + test 通過。                                                                                                                                                                                                                              |
| 2 状態管理整理       | 🟢   | 2026-05-29 | zustand 導入。App.tsx の62個の useState を useViewerStore / useFileStore / useUiStore に移行。toggle/update アクション追加。App.tsx 1,919→1,838行 (このフェーズでは行数削減より構造改善が主目的)。                                                                                                                                                                                                  |
| 3 CSS整理            | 🟢   | 2026-05-29 | design-system.css に `:root` 一本化 + `--font-mono`/`--font-sans` エイリアス追加。styles.css の hex 値をトークンに置換。`.btn-ghost`/`.btn-primary` を `<Button>` に移行→削除。未使用 CSS 削除（`.card-header-count`, `.extension-badges`, `.error-text`, `.warning-text`, `.viewer-state-warning`, `.viewer-state-danger`, `.range-control`, `.loader` 一式）。styles.css 2,436→2,124行 (-12.8%)。 |
| 4 型の一元管理       | 🟢   | 2026-05-29 | `src/types/` に ipc.ts (266行), file.ts (42行), viewer.ts (487行), ui.ts (122行) を作成。IPCワイヤ型、ファイル型、ビューワ/メタデータ型、UI状態型を一元管理。元ファイルに re-export を追加し、既存インポートの互換性を維持。tsc + test 197件 通過。 |
| 5 エラーハンドリング   | 🟢   | 2026-05-29 | Rust: `AppError` 列挙型 (Io/Usd/Serde/Timeout/Internal) を `thiserror` + `serde(tag)` で定義。40個の `#[tauri::command]` すべての戻り値を `Result<T, String>` → `Result<T, AppError>` に統一。TS: `invokeSafe` ユーティリティ作成、重複していた `errorMessage` を一本化。`cargo check` + `tsc` + test 197件 通過。                                                                                                                                                                                                                                                           |
| 6 テスト拡充         | ⏳   | —          |                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7 ビルド/CI最適化    | ⏳   | —          |                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8 小さな改善         | ⏳   | —          | 未使用の useRef インポート除去済み                                                                                                                                                                                                                                                                                                                                                                  |
