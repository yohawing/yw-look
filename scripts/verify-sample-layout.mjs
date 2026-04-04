import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "samples", "manifest.json");

function log(message) {
  process.stdout.write(`${message}\n`);
}

if (!fs.existsSync(manifestPath)) {
  log(
    "samples/manifest.json がありません。samples/manifest.example.json をコピーして作成してください。",
  );
  process.exit(1);
}

const raw = fs.readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(raw);
const cases = Array.isArray(manifest.cases) ? manifest.cases : [];

if (cases.length === 0) {
  log("manifest に cases がありません。");
  process.exit(1);
}

let missingCount = 0;
const formatCounts = new Map();

for (const entry of cases) {
  const abs = path.join(root, entry.path);
  const exists = fs.existsSync(abs);
  const format = entry.format || "unknown";
  formatCounts.set(format, (formatCounts.get(format) || 0) + 1);

  if (!exists) {
    missingCount += 1;
    log(`[MISSING] ${entry.id} -> ${entry.path}`);
  } else {
    log(`[OK] ${entry.id} -> ${entry.path}`);
  }
}

log("");
log("format counts:");
for (const [format, count] of [...formatCounts.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  log(`- ${format}: ${count}`);
}

log("");
if (missingCount > 0) {
  log(`不足ファイル: ${missingCount}`);
  process.exit(2);
}

log("サンプル配置は問題ありません。");
