import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readValue } from "./cliArgs.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const defaultRoot = "F:\\3dcg";
const defaultOut = path.join(
  repoRoot,
  "artifacts",
  "local-assets",
  "3dcg-assets.csv",
);

const assetTypes = {
  model: new Set([
    "abc",
    "dae",
    "fbx",
    "glb",
    "gltf",
    "obj",
    "pmd",
    "pmx",
    "ply",
    "stl",
    "usd",
    "usda",
    "usdc",
    "usdz",
    "vrm",
  ]),
  motion: new Set(["vmd", "vrma"]),
  splat: new Set(["ksplat", "sog", "splat", "spz"]),
  texture: new Set(["dds", "exr", "hdr", "jpeg", "jpg", "ktx2", "png", "tga"]),
};

const defaultKinds = new Set(["model", "motion", "splat"]);
const argv = parseArgs(process.argv.slice(2));

if (argv.help) {
  printUsage();
  process.exit(0);
}

const root = path.resolve(argv.root ?? defaultRoot);
const out = path.resolve(repoRoot, argv.out ?? defaultOut);
const kinds = parseKinds(argv.kinds, defaultKinds);
const limit =
  argv.limit === undefined || argv.limit === null ? null : Number(argv.limit);

if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
  throw new Error("--limit must be a positive number");
}

await assertDirectory(root);

const startedAt = Date.now();
const rows = [];
await walk(root, rows);
rows.sort((left, right) =>
  left.path.localeCompare(right.path, "ja", { numeric: true }),
);
const limitedRows = limit === null ? rows : rows.slice(0, limit);

await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, renderCsv(limitedRows), "utf8");

const summary = summarize(limitedRows);
console.log("=== collect-local-assets ===");
console.log(`Root    : ${root}`);
console.log(`Output  : ${out}`);
console.log(`Elapsed : ${Date.now() - startedAt}ms`);
console.log(`Total   : ${limitedRows.length}`);
for (const [kind, count] of Object.entries(summary.byKind)) {
  console.log(`${kind.padEnd(8)}: ${count}`);
}

async function assertDirectory(directory) {
  const info = await stat(directory);
  if (!info.isDirectory()) {
    throw new Error(`root is not a directory: ${directory}`);
  }
}

async function walk(directory, output) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    console.warn(
      `[scan] skipped unreadable directory: ${directory} (${formatError(error)})`,
    );
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, output);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).slice(1).toLowerCase();
    const kind = kindForExtension(extension);
    if (!kind || !kinds.has(kind)) {
      continue;
    }

    let info;
    try {
      info = await stat(fullPath);
    } catch (error) {
      console.warn(
        `[scan] skipped unreadable file: ${fullPath} (${formatError(error)})`,
      );
      continue;
    }

    output.push({
      id: createAssetId(root, fullPath),
      kind,
      extension,
      path: fullPath,
      relativePath: normalizePath(path.relative(root, fullPath)),
      fileName: entry.name,
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
  }
}

function kindForExtension(extension) {
  for (const [kind, extensions] of Object.entries(assetTypes)) {
    if (extensions.has(extension)) {
      return kind;
    }
  }
  return null;
}

function parseKinds(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  const unknown = [...parsed].filter((kind) => !assetTypes[kind]);
  if (unknown.length > 0) {
    throw new Error(`unknown kind(s): ${unknown.join(", ")}`);
  }
  return parsed;
}

function createAssetId(rootPath, filePath) {
  const relative = normalizePath(path.relative(rootPath, filePath));
  return relative
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function renderCsv(rows) {
  const header = [
    "id",
    "kind",
    "extension",
    "path",
    "relative_path",
    "file_name",
    "bytes",
    "modified_at",
    "enabled",
    "notes",
  ];
  return `${[header, ...rows.map(toCsvRow)]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n")}\n`;
}

function toCsvRow(row) {
  return [
    row.id,
    row.kind,
    row.extension,
    row.path,
    row.relativePath,
    row.fileName,
    String(row.bytes),
    row.modifiedAt,
    "1",
    "",
  ];
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function summarize(rows) {
  const byKind = Object.fromEntries(
    Object.keys(assetTypes).map((kind) => [kind, 0]),
  );
  for (const row of rows) {
    byKind[row.kind] += 1;
  }
  return { byKind };
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
    } else if (token === "--root") {
      parsed.root = readValue(tokens, ++index, token);
    } else if (token === "--out") {
      parsed.out = readValue(tokens, ++index, token);
    } else if (token === "--kinds") {
      parsed.kinds = readValue(tokens, ++index, token);
    } else if (token === "--limit") {
      parsed.limit = readValue(tokens, ++index, token);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return parsed;
}

function printUsage() {
  console.log(`usage:
  node scripts/collect-local-assets.mjs --root F:\\3dcg --out artifacts/local-assets/3dcg-assets.csv
  node scripts/collect-local-assets.mjs --root F:\\3dcg --kinds model,motion,splat

Scans a local asset tree and writes a CSV for scripts/local-asset-load-check.mjs.
Default kinds: model,motion,splat. Add texture with --kinds model,motion,splat,texture.`);
}
