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
const reportDir = path.join(repoRoot, "artifacts", "logs");
const reportPath = path.join(reportDir, "macos-codesign-report.json");
const markdownReportPath = path.join(reportDir, "macos-codesign-report.md");
const manualVerificationNote =
  "Finder Open With and quarantine-free first launch on a clean Mac are not proven by spctl alone. Verify manually on a clean macOS environment and record the result in release notes.";

const args = new Set(process.argv.slice(2));
const requireVerified = args.has("--require-verified");
const jsonOnly = args.has("--json");
const showHelp = args.has("--help") || args.has("-h");

function printHelp() {
  console.log(`Usage: node scripts/check-macos-codesign.mjs [--require-verified] [--json]

Audits macOS codesign, stapler, and Gatekeeper status for generated yw-look release artifacts.

Environment:
  YW_LOOK_MACOS_SIGN_CHECK_ROOT       Alternate bundle root. Defaults to src-tauri/target/release/bundle.
  YW_LOOK_MACOS_SIGN_CHECK_ARTIFACTS  Comma-separated explicit artifact paths.

Outputs (macOS default run):
  artifacts/logs/macos-codesign-report.json   Machine-readable audit evidence.
  artifacts/logs/macos-codesign-report.md     Release-log draft for CHANGELOG / GitHub Release notes.
                                                Manual Finder / first-launch checks are not verified by this script.

Modes:
  default             Write JSON and Markdown reports; exit 0 even when checks fail.
  --require-verified  Exit 1 unless signing, stapler, and Gatekeeper checks pass for .app and stapler passes for .dmg.
  --json              Write JSON and Markdown reports; print JSON report only to stdout.`);
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

function collectAppBundles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.join(directoryPath, entry.name));
}

function classifyArtifact(filePath) {
  const normalized = filePath.replaceAll(path.sep, "/");
  if (normalized.endsWith(".app")) {
    return "app";
  }
  if (normalized.endsWith(".dmg")) {
    return "dmg";
  }
  if (normalized.endsWith(".app.tar.gz")) {
    return "updater-archive";
  }
  return "unknown";
}

function discoverArtifacts() {
  const explicitArtifacts = process.env.YW_LOOK_MACOS_SIGN_CHECK_ARTIFACTS;
  if (explicitArtifacts) {
    return explicitArtifacts
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(toAbsolute);
  }

  const { version } = readJson(tauriConfigPath);
  const bundleRoot = path.resolve(
    process.env.YW_LOOK_MACOS_SIGN_CHECK_ROOT ?? defaultBundleRoot,
  );
  const versionMarker = `_${version}_`;
  const macosDir = path.join(bundleRoot, "macos");
  const dmgDir = path.join(bundleRoot, "dmg");

  return [
    ...collectAppBundles(macosDir),
    ...collectFiles(
      dmgDir,
      (name) =>
        name.toLowerCase().endsWith(".dmg") &&
        !name.toLowerCase().endsWith(".sig") &&
        name.includes(versionMarker),
    ),
    ...collectFiles(
      macosDir,
      (name) =>
        name.toLowerCase().endsWith(".app.tar.gz") &&
        !name.toLowerCase().endsWith(".sig"),
    ),
  ];
}

function runCommand(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  const output = [stdout, stderr].filter(Boolean).join("\n");

  return {
    exitCode: result.status ?? 1,
    stdout,
    stderr,
    output,
    error: result.error?.message ?? null,
  };
}

function parseCodesignDisplay(output) {
  const details = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    const value = match[2].trim();
    if (
      key === "Authority" ||
      key === "TeamIdentifier" ||
      key === "Identifier" ||
      key === "Format" ||
      key === "Signed Time" ||
      key === "Runtime Version"
    ) {
      if (details[key]) {
        if (Array.isArray(details[key])) {
          details[key].push(value);
        } else {
          details[key] = [details[key], value];
        }
      } else {
        details[key] = value;
      }
    }
  }
  return details;
}

function buildCheckResult(command, commandArgs, result, { passed }) {
  return {
    command: [command, ...commandArgs].join(" "),
    exitCode: result.exitCode,
    passed,
    stdout: result.stdout || null,
    stderr: result.stderr || null,
    error: result.error,
  };
}

function inspectAppBundle(filePath) {
  const display = runCommand("codesign", ["-dv", "--verbose=4", filePath]);
  const verify = runCommand("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    filePath,
  ]);
  const stapler = runCommand("xcrun", ["stapler", "validate", filePath]);
  const gatekeeper = runCommand("spctl", [
    "--assess",
    "--type",
    "execute",
    "--verbose=4",
    filePath,
  ]);

  const displayDetails = parseCodesignDisplay(display.output);

  return {
    path: toRelative(filePath),
    kind: "app",
    checks: {
      codesignDisplay: {
        ...buildCheckResult(
          "codesign",
          ["-dv", "--verbose=4", filePath],
          display,
          {
            passed: display.exitCode === 0,
          },
        ),
        details: displayDetails,
      },
      codesignVerify: buildCheckResult(
        "codesign",
        ["--verify", "--deep", "--strict", "--verbose=2", filePath],
        verify,
        { passed: verify.exitCode === 0 },
      ),
      staplerValidate: buildCheckResult(
        "xcrun",
        ["stapler", "validate", filePath],
        stapler,
        { passed: stapler.exitCode === 0 },
      ),
      gatekeeperAssess: buildCheckResult(
        "spctl",
        ["--assess", "--type", "execute", "--verbose=4", filePath],
        gatekeeper,
        { passed: gatekeeper.exitCode === 0 },
      ),
    },
  };
}

function inspectDmg(filePath) {
  const display = runCommand("codesign", ["-dv", "--verbose=4", filePath]);
  const stapler = runCommand("xcrun", ["stapler", "validate", filePath]);

  return {
    path: toRelative(filePath),
    kind: "dmg",
    checks: {
      codesignDisplay: {
        ...buildCheckResult(
          "codesign",
          ["-dv", "--verbose=4", filePath],
          display,
          {
            passed: display.exitCode === 0,
          },
        ),
        details: parseCodesignDisplay(display.output),
      },
      staplerValidate: buildCheckResult(
        "xcrun",
        ["stapler", "validate", filePath],
        stapler,
        { passed: stapler.exitCode === 0 },
      ),
    },
  };
}

function inspectUpdaterArchive(filePath) {
  const stats = fs.statSync(filePath);
  return {
    path: toRelative(filePath),
    kind: "updater-archive",
    sizeBytes: stats.size,
    checks: {
      note: "Updater archive presence only. codesign, stapler, and Gatekeeper apply to the bundled .app after extraction.",
    },
  };
}

function inspectArtifact(filePath) {
  const kind = classifyArtifact(filePath);
  if (kind === "app") {
    return inspectAppBundle(filePath);
  }
  if (kind === "dmg") {
    return inspectDmg(filePath);
  }
  if (kind === "updater-archive") {
    return inspectUpdaterArchive(filePath);
  }

  throw new Error(`Unsupported macOS artifact type: ${toRelative(filePath)}`);
}

function artifactPassesRequiredChecks(artifact) {
  if (artifact.kind === "app") {
    return (
      artifact.checks.codesignVerify.passed &&
      artifact.checks.staplerValidate.passed &&
      artifact.checks.gatekeeperAssess.passed
    );
  }
  if (artifact.kind === "dmg") {
    return artifact.checks.staplerValidate.passed;
  }
  return true;
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
      apps: 0,
      dmgs: 0,
      updaterArchives: 0,
      verified: 0,
      failed: 0,
    },
    manualVerificationNote,
  };
}

function buildReport(artifacts) {
  const inspected = artifacts.map(inspectArtifact);
  const apps = inspected.filter((artifact) => artifact.kind === "app");
  const dmgs = inspected.filter((artifact) => artifact.kind === "dmg");
  const updaterArchives = inspected.filter(
    (artifact) => artifact.kind === "updater-archive",
  );
  const auditable = inspected.filter(
    (artifact) => artifact.kind === "app" || artifact.kind === "dmg",
  );
  const verified = auditable.filter(artifactPassesRequiredChecks).length;

  return {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    skipped: false,
    requireVerified,
    artifacts: inspected,
    summary: {
      total: inspected.length,
      apps: apps.length,
      dmgs: dmgs.length,
      updaterArchives: updaterArchives.length,
      verified,
      failed: auditable.length - verified,
    },
    manualVerificationNote,
  };
}

function formatCommandUsed() {
  const flags = [];
  if (requireVerified) {
    flags.push("--require-verified");
  }
  if (jsonOnly) {
    flags.push("--json");
  }
  const flagSuffix = flags.length > 0 ? ` -- ${flags.join(" ")}` : "";
  return `npm run check:macos-codesign${flagSuffix}`;
}

function deriveVerificationStatus(report) {
  if (report.skipped) {
    return "not verified";
  }

  const apps = report.artifacts.filter((artifact) => artifact.kind === "app");
  const dmgs = report.artifacts.filter((artifact) => artifact.kind === "dmg");

  if (apps.length === 0) {
    return "not verified";
  }

  const appsPass = apps.every(artifactPassesRequiredChecks);
  const dmgsPass = dmgs.every(artifactPassesRequiredChecks);

  return appsPass && dmgsPass ? "verified" : "not verified";
}

function formatCheckStatus(check) {
  if (!check) {
    return "n/a";
  }
  return check.passed ? "pass" : "fail";
}

function buildMarkdownReport(report) {
  const commandUsed = formatCommandUsed();
  const status = deriveVerificationStatus(report);
  const lines = [
    "# macOS codesign audit (release log draft)",
    "",
    "> Draft for `CHANGELOG.md` / GitHub Release notes. Copy the **macOS codesign, notarization, and Gatekeeper** section into the release entry.",
    "> Manual Finder / first-launch checks are **not** verified by this script.",
    "",
    `- **Timestamp**: ${report.timestamp}`,
    `- **Command**: \`${commandUsed}\``,
    `- **JSON report**: \`${toRelative(reportPath)}\``,
    `- **Markdown report**: \`${toRelative(markdownReportPath)}\``,
    "",
    "## Release note draft",
    "",
    "### macOS codesign, notarization, and Gatekeeper",
    "",
    `- Status: ${status}`,
    `- Command: \`${commandUsed}\``,
  ];

  if (report.skipped) {
    lines.push(`- Skipped: ${report.reason}`);
  } else {
    lines.push(
      `- Summary: ${report.summary.verified} verified, ${report.summary.failed} failed (${report.summary.apps} app, ${report.summary.dmgs} dmg, ${report.summary.updaterArchives} updater archive; ${report.summary.total} total)`,
    );
    lines.push("- Artifacts:");
    for (const artifact of report.artifacts) {
      if (artifact.kind === "app") {
        const authority = artifact.checks.codesignDisplay.details.Authority;
        const authorityText = Array.isArray(authority)
          ? authority.join(" -> ")
          : (authority ?? "unknown");
        lines.push(
          `  - \`${artifact.path}\`: codesign=${formatCheckStatus(artifact.checks.codesignVerify)}, stapler=${formatCheckStatus(artifact.checks.staplerValidate)}, gatekeeper=${formatCheckStatus(artifact.checks.gatekeeperAssess)}, authority=${authorityText}`,
        );
      } else if (artifact.kind === "dmg") {
        lines.push(
          `  - \`${artifact.path}\`: stapler=${formatCheckStatus(artifact.checks.staplerValidate)}`,
        );
      } else {
        lines.push(
          `  - \`${artifact.path}\`: updater archive present (${artifact.sizeBytes} bytes); codesign/stapler/gatekeeper not applicable to archive file`,
        );
      }
    }
  }

  lines.push(
    "- Manual macOS checks: not verified by this script — verify Finder Open With and quarantine-free first launch on a clean macOS environment before release",
    `- JSON report: \`${toRelative(reportPath)}\``,
    "",
    "## Artifact details",
    "",
  );

  if (report.skipped || report.artifacts.length === 0) {
    lines.push("_No artifacts audited._", "");
  } else {
    lines.push(
      "| Path | Kind | codesign verify | stapler | Gatekeeper | Authority / notes |",
      "| ---- | ---- | --------------- | ------- | ---------- | ----------------- |",
    );
    for (const artifact of report.artifacts) {
      if (artifact.kind === "app") {
        const authority = artifact.checks.codesignDisplay.details.Authority;
        const authorityText = Array.isArray(authority)
          ? authority.join(" -> ")
          : (authority ?? "");
        lines.push(
          `| \`${artifact.path}\` | app | ${formatCheckStatus(artifact.checks.codesignVerify)} | ${formatCheckStatus(artifact.checks.staplerValidate)} | ${formatCheckStatus(artifact.checks.gatekeeperAssess)} | ${authorityText} |`,
        );
      } else if (artifact.kind === "dmg") {
        lines.push(
          `| \`${artifact.path}\` | dmg | n/a | ${formatCheckStatus(artifact.checks.staplerValidate)} | n/a | DMG stapler ticket |`,
        );
      } else {
        lines.push(
          `| \`${artifact.path}\` | updater-archive | n/a | n/a | n/a | presence only (${artifact.sizeBytes} bytes) |`,
        );
      }
    }
    lines.push("");
  }

  lines.push("## Manual verification policy", "", manualVerificationNote, "");

  return `${lines.join("\n")}\n`;
}

function writeReports(report) {
  ensureDir(reportDir);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownReportPath, buildMarkdownReport(report));
}

function printHumanSummary(report) {
  if (report.skipped) {
    console.log(`check:macos-codesign skipped: ${report.reason}`);
    return;
  }

  console.log(
    `check:macos-codesign audited ${report.summary.total} artifact(s): ${report.summary.verified} verified, ${report.summary.failed} failed (${report.summary.apps} app, ${report.summary.dmgs} dmg, ${report.summary.updaterArchives} updater archive)`,
  );
  for (const artifact of report.artifacts) {
    if (artifact.kind === "app") {
      console.log(
        `- ${artifact.path}: codesign=${formatCheckStatus(artifact.checks.codesignVerify)}, stapler=${formatCheckStatus(artifact.checks.staplerValidate)}, gatekeeper=${formatCheckStatus(artifact.checks.gatekeeperAssess)}`,
      );
    } else if (artifact.kind === "dmg") {
      console.log(
        `- ${artifact.path}: stapler=${formatCheckStatus(artifact.checks.staplerValidate)}`,
      );
    } else {
      console.log(`- ${artifact.path}: updater archive present`);
    }
  }
  console.log(`Verification status: ${deriveVerificationStatus(report)}`);
  console.log(`JSON report: ${toRelative(reportPath)}`);
  console.log(`Markdown report: ${toRelative(markdownReportPath)}`);
}

function main() {
  if (showHelp) {
    printHelp();
    return 0;
  }

  if (process.platform !== "darwin") {
    const report = buildSkipReport("macOS codesign audit requires macOS.");
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
      "No macOS release artifacts found. Run `npm run bundle:mac` or set YW_LOOK_MACOS_SIGN_CHECK_ARTIFACTS.",
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
  writeReports(report);

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanSummary(report);
  }

  if (requireVerified && deriveVerificationStatus(report) !== "verified") {
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
