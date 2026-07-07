#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const OUTPUT_PATH = path.join(
  repoRoot,
  "src",
  "generated",
  "licenseAttributions.ts",
);
const execFileAsync = promisify(execFile);

/** @typedef {"web" | "native"} LicenseAttributionSource */
/** @typedef {{ name: string; version: string; license: string; source: LicenseAttributionSource }} LicenseAttribution */

/**
 * @param {string} value
 */
function escapeTsString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * @param {readonly LicenseAttribution[]} attributions
 */
function renderAttributions(attributions) {
  return attributions
    .map(
      (entry) =>
        `  {
    name: "${escapeTsString(entry.name)}",
    version: "${escapeTsString(entry.version)}",
    license: "${escapeTsString(entry.license)}",
    source: "${entry.source}",
  },`,
    )
    .join("\n");
}

/**
 * @param {Record<string, { version?: string; license?: string }>} packages
 * @param {string} packageName
 * @returns {LicenseAttribution}
 */
function resolvePackageAttribution(packages, packageName) {
  const lockEntry = packages[`node_modules/${packageName}`];
  if (!lockEntry) {
    throw new Error(
      `Missing package-lock entry for runtime dependency: ${packageName}`,
    );
  }

  const version = lockEntry.version;
  const license = lockEntry.license;
  if (!version) {
    throw new Error(`Missing version for runtime dependency: ${packageName}`);
  }
  if (!license) {
    throw new Error(`Missing license for runtime dependency: ${packageName}`);
  }

  return { name: packageName, version, license, source: "web" };
}

/**
 * @param {{ license?: string | null; license_file?: string | null }} cargoPackage
 * @returns {Promise<string>}
 */
async function resolveCargoLicense(cargoPackage) {
  if (cargoPackage.license) {
    return cargoPackage.license;
  }

  if (cargoPackage.license_file) {
    const licenseText = await readFile(cargoPackage.license_file, "utf8");
    const firstLine = licenseText.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (/^MIT License$/i.test(firstLine)) {
      return "MIT";
    }
    if (/^Apache License/i.test(firstLine)) {
      return "Apache-2.0";
    }
    return `See ${path.basename(cargoPackage.license_file)}`;
  }

  throw new Error(
    `Missing license for native dependency: ${cargoPackage.name}`,
  );
}

/**
 * @param {{ cargoManifestPath?: string }} options
 * @returns {Promise<LicenseAttribution[]>}
 */
async function resolveNativeRuntimeAttributions({
  cargoManifestPath = path.join(repoRoot, "src-tauri", "Cargo.toml"),
} = {}) {
  const { stdout } = await execFileAsync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      cargoManifestPath,
      "--format-version",
      "1",
      "--quiet",
      "--features",
      "flip-compare",
    ],
    {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const cargoMetadata = JSON.parse(stdout);
  const rootPackage = cargoMetadata.packages.find(
    (cargoPackage) =>
      cargoPackage.name === "yw-look" && cargoPackage.source === null,
  );
  if (!rootPackage) {
    throw new Error("Cargo metadata is missing the yw-look root package.");
  }

  const rootNode = cargoMetadata.resolve.nodes.find(
    (node) => node.id === rootPackage.id,
  );
  if (!rootNode) {
    throw new Error("Cargo metadata is missing the yw-look resolve node.");
  }

  const packageById = new Map(
    cargoMetadata.packages.map((cargoPackage) => [
      cargoPackage.id,
      cargoPackage,
    ]),
  );
  const directRuntimeDeps = rootNode.deps
    .filter((dependency) =>
      dependency.dep_kinds.some((kind) => kind.kind === null),
    )
    .map((dependency) => packageById.get(dependency.pkg))
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));

  /** @type {LicenseAttribution[]} */
  const nativeLicenseAttributions = [];
  for (const dependency of directRuntimeDeps) {
    nativeLicenseAttributions.push({
      name: dependency.name,
      version: dependency.version,
      license: await resolveCargoLicense(dependency),
      source: "native",
    });
  }

  return nativeLicenseAttributions;
}

export async function generateLicenseAttributions({
  packageJsonPath = path.join(repoRoot, "package.json"),
  packageLockPath = path.join(repoRoot, "package-lock.json"),
  outputPath = OUTPUT_PATH,
} = {}) {
  const [packageJsonRaw, packageLockRaw] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(packageLockPath, "utf8"),
  ]);

  const packageJson = JSON.parse(packageJsonRaw);
  const packageLock = JSON.parse(packageLockRaw);
  const rootPackage = packageLock.packages?.[""];
  if (!rootPackage) {
    throw new Error("package-lock.json is missing the root package entry.");
  }

  const runtimePackageNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ].sort((left, right) => left.localeCompare(right));

  /** @type {LicenseAttribution[]} */
  const webRuntimeLicenseAttributions = runtimePackageNames.map((packageName) =>
    resolvePackageAttribution(packageLock.packages, packageName),
  );
  const nativeRuntimeLicenseAttributions =
    await resolveNativeRuntimeAttributions();
  const runtimeLicenseAttributions = [
    ...webRuntimeLicenseAttributions,
    ...nativeRuntimeLicenseAttributions,
  ];

  const projectName = packageJson.name ?? rootPackage.name;
  const projectVersion = packageJson.version ?? rootPackage.version;
  const projectLicense = packageJson.license ?? rootPackage.license;
  if (!projectName || !projectVersion || !projectLicense) {
    throw new Error("Project name, version, or license metadata is missing.");
  }

  const output = `// Generated by scripts/generate-license-attributions.mjs.
// Do not edit by hand.

export type LicenseAttribution = {
  name: string;
  version: string;
  license: string;
  source: "web" | "native";
};

export const projectName = "${escapeTsString(projectName)}" as const;
export const projectVersion = "${escapeTsString(projectVersion)}" as const;
export const projectLicense = "${escapeTsString(projectLicense)}" as const;

export const webRuntimeLicenseAttributions = [
${renderAttributions(webRuntimeLicenseAttributions)}
] as const satisfies readonly LicenseAttribution[];

export const nativeRuntimeLicenseAttributions = [
${renderAttributions(nativeRuntimeLicenseAttributions)}
] as const satisfies readonly LicenseAttribution[];

export const runtimeLicenseAttributions = [
  ...webRuntimeLicenseAttributions,
  ...nativeRuntimeLicenseAttributions,
] as const satisfies readonly LicenseAttribution[];
`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");

  return {
    outputPath,
    projectName,
    projectVersion,
    projectLicense,
    runtimeLicenseAttributions,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const result = await generateLicenseAttributions();
    console.log(
      `Wrote ${result.runtimeLicenseAttributions.length} runtime license attributions to ${path.relative(repoRoot, result.outputPath)}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
