import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const bundleDir = path.join(repoRoot, "src-tauri", "target", "release", "bundle");
const outputDir = path.join(repoRoot, "artifacts", "updater-feed");
const baseUrl =
  process.env.YW_LOOK_LOCAL_UPDATE_BASE_URL ?? "http://127.0.0.1:8765";
const target = process.env.YW_LOOK_LOCAL_UPDATE_TARGET ?? "windows-x86_64";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function findInstallerBundle() {
  const candidates = [
    path.join(bundleDir, "nsis"),
    path.join(bundleDir, "msi"),
  ];

  for (const directory of candidates) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    const installerName = fs
      .readdirSync(directory)
      .find((entry) => /\.(exe|msi)$/i.test(entry) && !entry.endsWith(".sig"));

    if (!installerName) {
      continue;
    }

    const signaturePath = path.join(directory, `${installerName}.sig`);
    if (!fs.existsSync(signaturePath)) {
      throw new Error(`Missing updater signature for ${installerName}`);
    }

    return {
      installerName,
      installerPath: path.join(directory, installerName),
      signaturePath,
    };
  }

  throw new Error(
    "No signed installer bundle found. Run `npm run bundle:win` with TAURI_SIGNING_PRIVATE_KEY configured first.",
  );
}

function main() {
  const tauriConfig = readJson(tauriConfigPath);
  const { version } = tauriConfig;
  const bundle = findInstallerBundle();
  const signature = fs.readFileSync(bundle.signaturePath, "utf8").trim();

  ensureDir(outputDir);
  fs.copyFileSync(bundle.installerPath, path.join(outputDir, bundle.installerName));
  fs.copyFileSync(
    bundle.signaturePath,
    path.join(outputDir, `${bundle.installerName}.sig`),
  );

  const manifest = {
    version,
    notes: `Local update bundle for yw-look ${version}.`,
    pub_date: new Date().toISOString(),
    platforms: {
      [target]: {
        signature,
        url: `${baseUrl}/${encodeURIComponent(bundle.installerName)}`,
      },
    },
  };

  fs.writeFileSync(
    path.join(outputDir, "latest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`Prepared local update feed in ${outputDir}`);
  console.log(`Endpoint: ${baseUrl}/latest.json`);
  console.log(`Installer: ${bundle.installerName}`);
}

main();
