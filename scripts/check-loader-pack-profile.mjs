#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const [profile, distDirArg = "dist"] = process.argv.slice(2);

if (!profile || !["core", "all"].includes(profile)) {
  console.error(
    "Usage: node scripts/check-loader-pack-profile.mjs <core|all> [dist-dir]",
  );
  process.exit(1);
}

const distDir = path.resolve(distDirArg);
const assetsDir = path.join(distDir, "assets");

async function listAssetFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listAssetFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      const info = await stat(fullPath);
      files.push({
        name: entry.name,
        path: fullPath,
        size: info.size,
      });
    }
  }

  return files;
}

function findAssets(files, pattern) {
  return files.filter((file) => pattern.test(file.name));
}

function assertNoAssets(files, pattern, label) {
  const matches = findAssets(files, pattern);
  if (matches.length > 0) {
    throw new Error(
      `${label} should not be present in ${profile} profile: ${matches
        .map((file) => file.name)
        .join(", ")}`,
    );
  }
}

function assertHasAssets(files, pattern, label) {
  const matches = findAssets(files, pattern);
  if (matches.length === 0) {
    throw new Error(`${label} was not found in ${profile} profile output.`);
  }
}

const files = await listAssetFiles(assetsDir);
const parseWorkers = findAssets(files, /^modelParse\.worker-.*\.js$/);
if (
  parseWorkers.length !== 1 ||
  !(await readFile(parseWorkers[0].path, "utf8")).includes("3mf-texture:")
)
  throw new Error(`3MF worker support is missing from ${profile} profile.`);

if (profile === "core") {
  assertNoAssets(files, /^spark-loader-pack-.*\.js$/, "Spark loader pack");
  assertNoAssets(files, /^mmd-loader-pack-.*\.js$/, "MMD loader pack");
  assertNoAssets(files, /^mmd_anim_wasm_bg-.*\.wasm$/, "MMD WASM runtime");
  assertHasAssets(
    files,
    /^loaderUnavailable-.*\.js$/,
    "loader unavailable shim",
  );
}

if (profile === "all") {
  assertHasAssets(files, /^spark-loader-pack-.*\.js$/, "Spark loader pack");
  assertHasAssets(files, /^mmd-loader-pack-.*\.js$/, "MMD loader pack");
  assertHasAssets(files, /^mmd_anim_wasm_bg-.*\.wasm$/, "MMD WASM runtime");
  assertNoAssets(
    files,
    /^loaderUnavailable-.*\.js$/,
    "loader unavailable shim",
  );
}

const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
console.log(
  `loader pack profile '${profile}' verified: ${files.length} assets, ${(
    totalBytes /
    1024 /
    1024
  ).toFixed(2)} MiB`,
);
