#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const defaultBundleRoot = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
);
const defaultMainBinary = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "yw-look.exe",
);
const reportPath = path.join(
  repoRoot,
  "artifacts",
  "logs",
  "win-authenticode-report.json",
);
const smartScreenNote =
  "SmartScreen reputation is not proven by Authenticode alone. Verify SmartScreen manually on a clean Windows environment and record the result in release notes.";

const args = new Set(process.argv.slice(2));
const requireSigned = args.has("--require-signed");
const jsonOnly = args.has("--json");
const showHelp = args.has("--help") || args.has("-h");

function printHelp() {
  console.log(`Usage: node scripts/check-win-authenticode.mjs [--require-signed] [--json]

Audits Windows Authenticode status for generated yw-look release artifacts.

Environment:
  YW_LOOK_WIN_SIGN_CHECK_ROOT       Alternate bundle root. Defaults to src-tauri/target/release/bundle.
  YW_LOOK_WIN_SIGN_CHECK_ARTIFACTS  Comma-separated explicit artifact paths.

Modes:
  default           Write artifacts/logs/win-authenticode-report.json and exit 0 even for NotSigned artifacts.
  --require-signed  Exit 1 unless every discovered artifact has Authenticode Status Valid.
  --json            Print the JSON report only.`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function toAbsolute(filePath) {
  return path.resolve(repoRoot, filePath);
}

function toRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function collectFiles(directoryPath, predicate) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(directoryPath, entry.name));
}

function discoverArtifacts() {
  const explicitArtifacts = process.env.YW_LOOK_WIN_SIGN_CHECK_ARTIFACTS;
  if (explicitArtifacts) {
    return explicitArtifacts
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(toAbsolute);
  }

  const { version } = readJson(tauriConfigPath);
  const bundleRoot = path.resolve(
    process.env.YW_LOOK_WIN_SIGN_CHECK_ROOT ?? defaultBundleRoot,
  );
  const versionMarker = `_${version}_`;
  const artifacts = [
    ...collectFiles(
      path.join(bundleRoot, "nsis"),
      (name) =>
        name.toLowerCase().endsWith(".exe") &&
        !name.toLowerCase().endsWith(".sig") &&
        name.includes(versionMarker),
    ),
    ...collectFiles(
      path.join(bundleRoot, "msi"),
      (name) =>
        name.toLowerCase().endsWith(".msi") &&
        !name.toLowerCase().endsWith(".sig") &&
        name.includes(versionMarker),
    ),
  ];

  if (fs.existsSync(defaultMainBinary)) {
    artifacts.push(defaultMainBinary);
  }

  return artifacts;
}

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function runPowerShell(script) {
  const encodedCommand = encodePowerShell(script);
  const hosts = ["pwsh.exe", "powershell.exe"];
  let lastError = "";

  for (const host of hosts) {
    const args =
      host === "powershell.exe"
        ? [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            encodedCommand,
          ]
        : ["-NoProfile", "-EncodedCommand", encodedCommand];
    const result = spawnSync(host, args, { encoding: "utf8" });

    if (result.error) {
      lastError = result.error.message;
      continue;
    }
    if (result.status === 0) {
      return result.stdout.trim();
    }

    lastError = result.stderr.trim() || result.stdout.trim();
  }

  throw new Error(lastError || "No usable PowerShell host found");
}

function inspectAuthenticode(filePath) {
  const pathBase64 = Buffer.from(filePath, "utf8").toString("base64");
  const script = `
$ErrorActionPreference = "Stop"
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
$artifactPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${pathBase64}"))
$signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
[pscustomobject]@{
  Path = $artifactPath
  Status = $signature.Status.ToString()
  StatusMessage = $signature.StatusMessage
  Signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  SignerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
  Timestamped = $null -ne $signature.TimeStamperCertificate
  TimeStamper = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
} | ConvertTo-Json -Compress -Depth 4
`;

  let output;
  try {
    output = runPowerShell(script);
  } catch (error) {
    throw new Error(
      `Get-AuthenticodeSignature failed for ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }

  const parsed = JSON.parse(output);
  return {
    path: toRelative(parsed.Path),
    status: parsed.Status,
    statusMessage: parsed.StatusMessage,
    signer: parsed.Signer,
    signerThumbprint: parsed.SignerThumbprint,
    timestamped: Boolean(parsed.Timestamped),
    timeStamper: parsed.TimeStamper,
  };
}

function buildSkipReport(reason) {
  return {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    skipped: true,
    reason,
    artifacts: [],
    summary: {
      total: 0,
      valid: 0,
      unsigned: 0,
      invalid: 0,
    },
    smartScreenNote,
  };
}

function buildReport(artifacts) {
  const inspected = artifacts.map(inspectAuthenticode);
  const summary = {
    total: inspected.length,
    valid: inspected.filter((artifact) => artifact.status === "Valid").length,
    unsigned: inspected.filter((artifact) => artifact.status === "NotSigned")
      .length,
    invalid: inspected.filter(
      (artifact) =>
        artifact.status !== "Valid" && artifact.status !== "NotSigned",
    ).length,
  };

  return {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    skipped: false,
    requireSigned,
    artifacts: inspected,
    summary,
    smartScreenNote,
  };
}

function writeReport(report) {
  ensureDir(path.dirname(reportPath));
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function printHumanSummary(report) {
  if (report.skipped) {
    console.log(`check:win-authenticode skipped: ${report.reason}`);
    return;
  }

  console.log(
    `check:win-authenticode audited ${report.summary.total} artifact(s): ${report.summary.valid} valid, ${report.summary.unsigned} unsigned, ${report.summary.invalid} invalid`,
  );
  for (const artifact of report.artifacts) {
    const signer = artifact.signer ? ` signer=${artifact.signer}` : "";
    const timestamped = artifact.timestamped ? " timestamped=yes" : "";
    console.log(
      `- ${artifact.path}: ${artifact.status}${timestamped}${signer}`,
    );
  }
  console.log(`Report: ${toRelative(reportPath)}`);
}

function main() {
  if (showHelp) {
    printHelp();
    return 0;
  }

  if (process.platform !== "win32") {
    const report = buildSkipReport(
      "Windows Authenticode audit requires Windows.",
    );
    if (jsonOnly) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHumanSummary(report);
    }
    return 0;
  }

  const artifacts = discoverArtifacts();
  if (artifacts.length === 0) {
    throw new Error(
      "No Windows release artifacts found. Run `npm run bundle:win:loaders` or set YW_LOOK_WIN_SIGN_CHECK_ARTIFACTS.",
    );
  }

  const missingArtifacts = artifacts.filter(
    (artifact) => !fs.existsSync(artifact),
  );
  if (missingArtifacts.length > 0) {
    throw new Error(
      `Missing explicit signing artifacts: ${missingArtifacts.map(toRelative).join(", ")}`,
    );
  }

  const report = buildReport([...new Set(artifacts)]);
  writeReport(report);

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanSummary(report);
  }

  if (requireSigned && report.summary.valid !== report.summary.total) {
    return 1;
  }

  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
