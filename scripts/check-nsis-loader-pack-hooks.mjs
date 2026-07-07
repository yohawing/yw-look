#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOADER_PACKS,
  buildPackManifest,
  generateNsisLoaderPackHooks,
  renderTemplate,
  toNsisFileWriteLine,
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
  "  IfSilent 0 +2",
  '  ${GetOptions} $R0 "/P" $R1',
  '  ${If} $YwOptionalLoaderPacksPageVisited == "1"',
  '  FileWrite $0 "removed by installer$\\r$\\n"',
  '"Choose optional loader packs to install with yw-look."',
];

function assertIncludes(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`${label} is missing from generated NSIS hook: ${needle}`);
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function readCargoPackageVersion() {
  const cargoToml = await readFile(
    path.join(repoRoot, "src-tauri", "Cargo.toml"),
    "utf8",
  );
  let inPackageSection = false;
  for (const line of cargoToml.split(/\r?\n/)) {
    if (line === "[package]") {
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && line.startsWith("[")) {
      break;
    }
    const version = line.match(/^\s*version\s*=\s*"(?<version>[^"]+)"\s*$/)
      ?.groups?.version;
    if (inPackageSection && version) {
      return version;
    }
  }
  throw new Error("src-tauri/Cargo.toml [package] version is missing");
}

function assertJsonEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${label} mismatch:\nexpected ${expectedJson}\nactual   ${actualJson}`,
    );
  }
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
  const cargoVersion = await readCargoPackageVersion();
  const tauriConfig = await readJson("src-tauri/tauri.conf.json");

  if (cargoVersion !== generated.version) {
    throw new Error(
      `src-tauri/Cargo.toml version (${cargoVersion}) must match package.json version (${generated.version})`,
    );
  }
  if (tauriConfig.version !== generated.version) {
    throw new Error(
      `src-tauri/tauri.conf.json version (${tauriConfig.version}) must match package.json version (${generated.version})`,
    );
  }

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
    const manifest = buildPackManifest(pack, generated.version);

    assertIncludes(onDisk, pack.checkboxLabel, `${pack.id} checkbox label`);
    assertIncludes(
      onDisk,
      toNsisFileWriteLine(manifest),
      `${pack.id} manifest FileWrite line`,
    );
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
    assertIncludes(
      onDisk,
      `Call ${pack.installFunction}`,
      `${pack.id} install call`,
    );
    assertIncludes(
      onDisk,
      `Call ${pack.removeFunction}`,
      `${pack.id} remove call`,
    );
    assertIncludes(
      onDisk,
      `Delete "$APPDATA\\com.yohawing.ywlook\\optional-loaders\\${pack.installDir}\\.removed"`,
      `${pack.id} install clears tombstone`,
    );
    assertIncludes(
      onDisk,
      `FileOpen $0 "$APPDATA\\com.yohawing.ywlook\\optional-loaders\\${pack.installDir}\\manifest.json" w`,
      `${pack.id} manifest write target`,
    );
    assertIncludes(
      onDisk,
      `FileOpen $0 "$APPDATA\\com.yohawing.ywlook\\optional-loaders\\${pack.installDir}\\.removed" w`,
      `${pack.id} remove writes tombstone`,
    );

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
  assertJsonEqual(
    meta.packs,
    LOADER_PACKS.map((pack) => ({
      ...buildPackManifest(pack, generated.version),
      installDir: pack.installDir,
    })),
    "optional-loader-packs.meta.json packs",
  );

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
