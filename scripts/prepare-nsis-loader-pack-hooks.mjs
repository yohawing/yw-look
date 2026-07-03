#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const LOADER_PACKS = [
  {
    id: "mmd-loader-pack",
    name: "MMD Loader Pack",
    installDir: "mmd",
    extensions: ["pmd", "pmx", "vmd"],
    checkboxLabel: "MMD Loader Pack (.pmx, .pmd, .vmd)",
    manifestPlaceholder: "__YW_MMD_MANIFEST_FILEWRITE__",
    installFunction: "YwInstallMmdLoaderPack",
    removeFunction: "YwRemoveMmdLoaderPack",
  },
  {
    id: "gaussian-splat-loader-pack",
    name: "Gaussian Splat Loader Pack",
    installDir: "gaussian-splat",
    extensions: ["splat", "spz", "ksplat", "sog"],
    checkboxLabel: "Gaussian Splat Loader Pack (.splat, .spz, .ksplat, .sog)",
    manifestPlaceholder: "__YW_GAUSSIAN_SPLAT_MANIFEST_FILEWRITE__",
    installFunction: "YwInstallGaussianSplatLoaderPack",
    removeFunction: "YwRemoveGaussianSplatLoaderPack",
  },
];

export function buildPackManifest(pack, version) {
  return {
    id: pack.id,
    name: pack.name,
    version,
    minimumAppVersion: version,
    extensions: pack.extensions,
    entry: "loader.js",
    kind: "firstPartyLoaderPack",
  };
}

export function toNsisFileWriteLine(manifest) {
  const json = JSON.stringify(manifest);
  const escaped = json.replaceAll('"', '$\\"');
  return `  FileWrite $0 "${escaped}$\\r$\\n"`;
}

export function renderTemplate(template, version) {
  let output = template;

  for (const pack of LOADER_PACKS) {
    if (!output.includes(pack.manifestPlaceholder)) {
      throw new Error(
        `NSIS template is missing placeholder ${pack.manifestPlaceholder}`,
      );
    }
    const manifestLine = toNsisFileWriteLine(buildPackManifest(pack, version));
    output = output.replaceAll(pack.manifestPlaceholder, manifestLine);
  }

  if (output.includes("__YW_")) {
    throw new Error(
      "NSIS template still contains unresolved __YW_ placeholders",
    );
  }

  return output;
}

export async function readPackageVersion(root = repoRoot) {
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error("package.json version must be a non-empty string");
  }
  return packageJson.version;
}

export async function generateNsisLoaderPackHooks(root = repoRoot) {
  const version = await readPackageVersion(root);
  const template = await readFile(
    path.join(root, "src-tauri", "nsis", "optional-loader-packs.template.nsh"),
    "utf8",
  );
  const output = renderTemplate(template, version);
  const outputPath = path.join(
    root,
    "src-tauri",
    "target",
    "nsis",
    "optional-loader-packs.generated.nsh",
  );
  const metaPath = path.join(
    root,
    "src-tauri",
    "target",
    "nsis",
    "optional-loader-packs.meta.json",
  );

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");
  await writeFile(
    metaPath,
    `${JSON.stringify(
      {
        appVersion: version,
        packs: LOADER_PACKS.map((pack) => ({
          ...buildPackManifest(pack, version),
          installDir: pack.installDir,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    version,
    outputPath,
    metaPath,
    output,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { outputPath } = await generateNsisLoaderPackHooks();
  console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
}
