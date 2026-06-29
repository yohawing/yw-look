#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const templatePath = path.join(
  repoRoot,
  "src-tauri",
  "nsis",
  "optional-loader-packs.template.nsh",
);
const outputPath = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "nsis",
  "optional-loader-packs.generated.nsh",
);

const template = await readFile(templatePath, "utf8");
const output = template.replaceAll("__YW_LOOK_VERSION__", packageJson.version);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");

console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
