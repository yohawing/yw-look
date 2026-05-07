#!/usr/bin/env node
// README の Test Coverage 表を更新するための小スクリプト。
//   node scripts/count-tests.mjs        # 表形式で出力
//   node scripts/count-tests.mjs --json # JSON で出力 (CI / 自動化向け)
//
// テストランナーを起動せずに静的にカウントするため、動的生成された
// テストケースは無視される。値は README 用の概算。

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const JS_TEST_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/;
const JS_CASE_RE =
  /^\s*(?:it|test)(?:\.skip|\.only|\.todo|\.each\([^)]*\))?\s*\(/gm;
const RUST_CASE_RE = /^\s*#\[(?:tokio::|tauri::)?test\]/gm;

const srcFiles = await walk(join(ROOT, "src"));
const jsTestFiles = srcFiles.filter((p) => JS_TEST_RE.test(p));

let jsTestCases = 0;
for (const file of jsTestFiles) {
  const src = await readFile(file, "utf8");
  const matches = src.match(JS_CASE_RE);
  if (matches) jsTestCases += matches.length;
}

const rustFiles = [
  ...(await walk(join(ROOT, "src-tauri", "src"))),
  ...(await walk(join(ROOT, "src-tauri", "tests"))),
].filter((p) => p.endsWith(".rs"));

let rustTestCases = 0;
const rustTestFiles = [];
for (const file of rustFiles) {
  const src = await readFile(file, "utf8");
  const matches = src.match(RUST_CASE_RE);
  if (!matches) continue;
  rustTestFiles.push(file);
  rustTestCases += matches.length;
}

const fixtureRoots = [
  "tests/fixtures/models",
  "tests/fixtures/textures",
  "tests/fixtures/broken",
];
let fixtureFiles = 0;
for (const sub of fixtureRoots) {
  const files = await walk(join(ROOT, sub));
  fixtureFiles += files.filter((p) => !p.endsWith("README.md")).length;
}

let catalogCases = 0;
try {
  const cat = JSON.parse(
    await readFile(join(ROOT, "tests/fixtures/catalog.json"), "utf8"),
  );
  catalogCases = Array.isArray(cat.cases) ? cat.cases.length : 0;
} catch {
  // optional
}

const result = {
  testFiles: jsTestFiles.length + rustTestFiles.length,
  testCases: jsTestCases + rustTestCases,
  frontendTestFiles: jsTestFiles.length,
  frontendTestCases: jsTestCases,
  rustTestFiles: rustTestFiles.length,
  rustTestCases,
  fixtureFiles,
  fixtureCatalogCases: catalogCases,
  files: [...jsTestFiles, ...rustTestFiles].map((f) =>
    relative(ROOT, f).replace(/\\/g, "/"),
  ),
};

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} else {
  const rows = [
    ["Test files", result.testFiles],
    ["Test cases", result.testCases],
    ["Frontend test files", result.frontendTestFiles],
    ["Frontend test cases", result.frontendTestCases],
    ["Rust test files", result.rustTestFiles],
    ["Rust test cases", result.rustTestCases],
    ["Fixture assets", result.fixtureFiles],
    ["Fixture catalog cases", result.fixtureCatalogCases],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) process.stdout.write(`${k.padEnd(w)}  ${v}\n`);
}
