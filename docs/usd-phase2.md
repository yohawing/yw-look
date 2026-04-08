# USD Phase 2 — UX 反映

## 目的

Phase 1 で `src-tauri/src/usd/` に `inspect_stage` / `summarize_stage` / `collect_asset_issues` を実装したが、フロントエンドは `inspect_stage` を `metersPerUnit` ヒントにしか使っていない。Phase 2 ではこれらの Rust 側結果を UI に正しく反映し、USD 読み込み体験を「重い Three.js parse を待たせきり」から「まず stage サマリを見せて重い parse は後追い」に変える。

Phase 0 の宿題 (`docs/usd-phase0.md:131-135`) を消化するフェーズでもある。

## 達成条件

1. USD を開いた瞬間、`summarize_stage` の結果 (layerCount / rootPrimCount / meshCount / payloadCount / hasVariants / warnings) がサイドバーに表示される
2. `collect_asset_issues` の結果が既存の WarningsCard に合流する（broken reference / missing payload / suspicious metersPerUnit）
3. `inspect_stage` の結果 (defaultPrim / upAxis / missingAssets) もサイドバーに表示される
4. Three.js `USDLoader.parse` の同期ブロッキングがサマリ表示より後にずれる（サマリが先に paint される）
5. Web Worker への退避はスケルトンを用意して有効化可否を検証できる状態にする（本番有効化は Phase 3 以降）

Phase 1 で既に置いた `src/components/UsdInspectorCard.tsx` (未配線) は Phase 2 で正式に配線する。

## 設計

### 読み込みパイプラインの 2 段化

```
currentFile 変更
 ├─ (A) App 側: summarize_stage + inspect_stage + collect_asset_issues を parallel で呼ぶ
 │     → UsdInspectorCard / WarningsCard が即座に更新される
 └─ (B) AssetViewport 側: loadPreviewObject → USDLoader.parse
        → requestAnimationFrame で 1 フレーム譲ってから parse 実行
        → 成功すれば viewer に scene を差し込む
```

重要な制約:

- (A) と (B) は互いに待たない。(A) が先に終わればユーザーにはサマリが見え、(B) が終われば 3D が見える
- Rust 呼び出しは Tauri 環境のみ。ブラウザプレビューでは noop にする（環境判定は既存 `isTauriEnvironment()` を流用）
- USDZ は Three.js が ZIP を解く必要があるため、(B) 側での読み込みは現状維持

### 状態管理

App.tsx の既存パターンに合わせて `useState` を追加する。新しい store は導入しない。

```tsx
const [usdSummary, setUsdSummary] = useState<StageSummary | null>(null);
const [usdInspection, setUsdInspection] = useState<StageInspection | null>(
  null,
);
const [usdIssues, setUsdIssues] = useState<AssetIssue[]>([]);
const [usdInspectorLoading, setUsdInspectorLoading] = useState(false);
const [usdInspectorError, setUsdInspectorError] = useState<string | null>(null);
```

`useEffect([currentFile])` で以下を行う:

- USD 拡張子でない or 非 Tauri 環境 → 全部クリア
- それ以外 → `loading=true` にして `summarizeStage` / `inspectStage` / `collectAssetIssues` を並列に投げる
- 各 RPC は解決したものから個別に state を更新する（summary / inspection / issues をまとめて待たない）
- `loading` の解除は `Promise.allSettled([...])` で全リクエスト完了後に行い、失敗時は `error` を set する

`inspect_stage` が hints 経由で `loaders.ts` からも呼ばれるのを整理する:

- Phase 1 は `loaders.ts` 内で `inspectStage(path)` を呼んで `metersPerUnit` のみ使っていた
- Phase 2 は App 側が `inspectStage` を呼ぶので重複する
- 解決: `loaders.ts` の `parseUsdRuntimeHints` は App 側の結果を受け取るよう refactor する（引数でヒントを渡すか、バックアップとして自前で呼ぶ二段構え）

ひとまず Phase 2 の最初のコミットでは **既存 `parseUsdRuntimeHints` は温存し、App 側の inspect は並列で独立して走らせる**。2 回呼ばれても軽量なので回帰リスクを下げる。

### UsdInspectorCard の配置

- 配線先: `sidebarContent` の `"file"` ケース、`CurrentFileCard` と `PerformanceCard` の間
- 表示条件: `currentFile.extension` が USD 系のときのみ。それ以外は card 自体を出さない
- 既存 card API (`summary` / `inspection` / `issues` / `loading` / `error`) はそのまま使う

### AssetIssue → WarningsCard

既存の `warnings: string[]` パイプラインに合流させる。

- AssetIssue を string にフォーマットする関数 `formatAssetIssue(issue: AssetIssue): string` を追加
- `warnings` useMemo の依存に `usdIssues` を追加し、error レベル優先で文字列化して push

Phase 3 以降で構造化された `Issue` 型を受ける WarningsCard に拡張したくなるかもしれないが、Phase 2 は既存 API に寄せる。

### USDLoader.parse の yield

`loaders.ts` の USD ケースで、`loader.parse(...)` の直前に 1 フレーム譲る:

```ts
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const object = usdaText ? loader.parse(usdaText) : loader.parse(buffer);
```

これで (A) の summary 結果が paint されてから (B) の parse が始まる。単純だが、実測で Kitchen Set クラスの parse が入った瞬間に summary がまだ visible だった、という可視フィードバックが得られるだけでも UX 上の大勝。

### Web Worker スケルトン

本命の worker 退避は Three.js USDLoader の worker 実行可能性に依存する。現時点で判明している難点:

- USDLoader が返すのは Three.js の `Group`。構造化クローン不可
- 回避するには worker 内で `Group.toJSON()` → main thread で `ObjectLoader.parse()` と、material / texture 情報がロスるケースを受け入れる必要がある
- USDZ は zip 展開を含むため worker 内で fflate と FileLoader のセットアップが追加で要る

Phase 2 では次を用意する:

- `src/workers/usdLoader.worker.ts` — `parse(buffer) → Group.toJSON()` を実装した実験用 worker
- `src/viewer/usdWorkerLoader.ts` — worker 呼び出しと `ObjectLoader` 再構築の wrapper
- **default は OFF**。`import.meta.env.VITE_USD_WORKER` が `"1"` のときだけ有効化する
- 失敗時は既存の同期 parse にフォールバックする

実運用で正式に ON にするのは Phase 3 で、Kitchen Set / USDZ 両方で material 再現度の検証を経てからとする。

## 非スコープ

- 新しい Rust command の追加
- `openusd` fork への新規 PR
- USDLoader 自体のパッチ / 置き換え
- 構造化された Issue 型への WarningsCard 拡張（既存 string 合流で留める）
- Phase 3 以降の予定: native instancing 対応（`mxpv/openusd` 側の fix を待つ）、USDZ 内部テクスチャの Rust 側インスペクション、material prim の詳細表示

## コミット粒度

1. `docs: add usd phase2 plan` — このドキュメント
2. `viewer(usd): defer three parse until after summary paint` — (B) の yield 追加
3. `ui(usd): surface stage summary and inspection in sidebar` — App 状態 + UsdInspectorCard 配線
4. `ui(usd): route asset issues through warnings card` — AssetIssue → 既存 warnings 合流
5. `perf(usd): add experimental usd parse worker scaffold` — worker + wrapper、default OFF

各コミット前に `codex-review` で差分をレビューする（AGENTS.md のルール）。

## 検証

- `samples/assets/usd/tiny.usda` を開いて
  - UsdInspectorCard に layers=1 / meshes=1 / rootPrims=1 / variants=no / defaultPrim=Root / upAxis=Y が出ること
  - warnings が空であること
  - 3D プレビューが従来通り表示されること
- `samples/private/usd/Kitchen_set/...` を開いて（ローカルのみ）
  - UsdInspectorCard に layers=229 / rootPrims=77 が **先に** 出て、そのあと 3D が描画されること
  - 開発者ツールで `[usd] inspectStage OK in Nms` ログが残っていること
- 非 USD (例: `.glb`) を開いたときに UsdInspectorCard が **表示されない** こと
- ブラウザプレビューで Tauri API 未定義エラーが出ないこと（環境分岐が効いていること）
