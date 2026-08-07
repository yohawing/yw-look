#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const OPTIONAL_EXTENSIONS = new Set([
  "vrm",
  "vrma",
  "pmd",
  "pmx",
  "vmd",
  "splat",
  "spz",
  "ksplat",
  "sog",
  "ifc",
]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

function collectBundleExtensions(fileAssociations) {
  const extensions = new Set();

  for (const association of fileAssociations) {
    for (const extension of association.ext ?? []) {
      extensions.add(extension.toLowerCase());
    }
  }

  return extensions;
}

function collectCoreExtensions(formatSupport) {
  const extensions = new Set();

  for (const category of ["model", "texture", "motion"]) {
    for (const extension of formatSupport[category] ?? []) {
      const normalized = extension.toLowerCase();
      if (!OPTIONAL_EXTENSIONS.has(normalized)) {
        extensions.add(normalized);
      }
    }
  }

  return extensions;
}

async function main() {
  const tauriConfig = await readJson("src-tauri/tauri.conf.json");
  const formatSupport = await readJson("src/formatSupport.json");

  const bundleExtensions = collectBundleExtensions(
    tauriConfig.bundle?.fileAssociations ?? [],
  );
  const coreExtensions = collectCoreExtensions(formatSupport);

  const optionalInBundle = [...bundleExtensions].filter((extension) =>
    OPTIONAL_EXTENSIONS.has(extension),
  );
  if (optionalInBundle.length > 0) {
    throw new Error(
      `Static bundle fileAssociations must not include optional loader pack extensions: ${optionalInBundle.sort().join(", ")}`,
    );
  }

  const missingCore = [...coreExtensions]
    .filter((extension) => !bundleExtensions.has(extension))
    .sort();
  if (missingCore.length > 0) {
    throw new Error(
      `Static bundle fileAssociations is missing core extensions from formatSupport.json: ${missingCore.join(", ")}`,
    );
  }

  console.log(
    `check:file-associations ok (${bundleExtensions.size} static extensions, ${coreExtensions.size} core extensions)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
