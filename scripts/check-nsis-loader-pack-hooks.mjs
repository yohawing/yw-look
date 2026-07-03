#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOADER_PACKS,
  generateNsisLoaderPackHooks,
  renderTemplate,
} from "./prepare-nsis-loader-pack-hooks.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const REQUIRED_NSIS_MARKERS = [
  "!macro NSIS_HOOK_POSTINSTALL",
  "!macro NSIS_HOOK_POSTUNINSTALL",
  "Function YwOptionalLoaderPacksPage",
  "Function YwOptionalLoaderPacksPageLeave",
];

function assertIncludes(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`${label} is missing from generated NSIS hook: ${needle}`);
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function main() {
  const template = await readFile(
    path.join(
      repoRoot,
      "src-tauri",
      "nsis",
      "optional-loader-packs.template.nsh",
    ),
    "utf8",
  );
  const generated = await generateNsisLoaderPackHooks();
  const onDisk = await readFile(generated.outputPath, "utf8");
  const expected = renderTemplate(template, generated.version);

  if (onDisk !== expected) {
    throw new Error(
      "Generated NSIS hook is stale or non-deterministic. Re-run `npm run prepare:nsis-loader-packs`.",
    );
  }

  if (onDisk.includes("__YW_")) {
    throw new Error("Generated NSIS hook still contains __YW_ placeholders");
  }

  for (const marker of REQUIRED_NSIS_MARKERS) {
    assertIncludes(onDisk, marker, "Required NSIS marker");
  }

  for (const pack of LOADER_PACKS) {
    assertIncludes(onDisk, pack.checkboxLabel, `${pack.id} checkbox label`);
    assertIncludes(
      onDisk,
      `$\\"id$\\":$\\"${pack.id}$\\"`,
      `${pack.id} manifest id`,
    );
    assertIncludes(
      onDisk,
      `$APPDATA\\com.yohawing.ywlook\\optional-loaders\\${pack.installDir}`,
      `${pack.id} install directory`,
    );
    assertIncludes(onDisk, pack.installFunction, `${pack.id} install function`);
    assertIncludes(onDisk, pack.removeFunction, `${pack.id} remove function`);

    for (const extension of pack.extensions) {
      assertIncludes(
        onDisk,
        `$\\"${extension}$\\"`,
        `${pack.id} extension ${extension}`,
      );
    }
  }

  assertIncludes(onDisk, generated.version, "package.json version");

  const loadersConfig = await readJson("src-tauri/tauri.windows.loaders.json");
  const installerHooks =
    loadersConfig.bundle?.windows?.nsis?.installerHooks ?? "";
  const expectedHook = "target/nsis/optional-loader-packs.generated.nsh";
  if (installerHooks !== expectedHook) {
    throw new Error(
      `src-tauri/tauri.windows.loaders.json installerHooks must be '${expectedHook}', got '${installerHooks}'`,
    );
  }

  const meta = JSON.parse(await readFile(generated.metaPath, "utf8"));
  if (meta.appVersion !== generated.version) {
    throw new Error("optional-loader-packs.meta.json appVersion mismatch");
  }
  if (meta.packs.length !== LOADER_PACKS.length) {
    throw new Error("optional-loader-packs.meta.json pack count mismatch");
  }

  console.log(
    `NSIS optional loader pack hooks verified for v${generated.version} (${LOADER_PACKS.length} packs)`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
