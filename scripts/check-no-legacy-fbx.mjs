#!/usr/bin/env node
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Keep the forbidden spellings assembled so this check cannot accidentally
// pass or fail because it scanned its own source text.
const legacyLoader = ["FBX", "Loader"].join("");
const legacyVendor = [legacyLoader, "Patched"].join("");
const legacyKindDoubleQuoted = ["kind", ":", '"', "fbx", '"'].join("");
const legacyKindSingleQuoted = ["kind", ":", "'", "fbx", "'"].join("");
const forbidden = [
  legacyLoader,
  legacyVendor,
  legacyKindDoubleQuoted,
  legacyKindSingleQuoted,
];
const sourceExtensions = new Set([
  ".css",
  ".d.ts",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".ts",
  ".tsx",
]);
const roots = ["src", "scripts", "dist", "public"];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (sourceExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  const vendorPaths = [
    path.join(repoRoot, "src/vendor", `${legacyVendor}.js`),
    path.join(repoRoot, "src/vendor", `${legacyVendor}.d.ts`),
  ];
  const existingVendors = [];
  for (const filePath of vendorPaths) {
    if (await exists(filePath)) existingVendors.push(filePath);
  }
  if (existingVendors.length > 0) {
    throw new Error(
      `legacy FBX vendor files still exist: ${existingVendors
        .map((filePath) => path.relative(repoRoot, filePath))
        .join(", ")}`,
    );
  }

  const files = [
    path.join(repoRoot, "package.json"),
    path.join(repoRoot, "eslint.config.js"),
    ...(
      await Promise.all(roots.map((root) => walk(path.join(repoRoot, root))))
    ).flat(),
  ];
  const violations = [];
  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    for (const token of forbidden) {
      if (source.includes(token)) {
        violations.push(
          `${path.relative(repoRoot, filePath)} contains ${token}`,
        );
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `legacy FBX parser references remain:\n${violations.join("\n")}`,
    );
  }

  console.log("legacy FBX parser references absent from source/build paths");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
