#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasFlag, readOption } from "./cliArgs.mjs";
import { runChildProcess } from "./processRunner.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const reportDir = path.join(repoRoot, "artifacts", "logs");
const jsonReportPath = path.join(reportDir, "release-preflight-report.json");
const markdownReportPath = path.join(reportDir, "release-preflight-report.md");
const bundleRoot = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
);
const windowsMainBinary = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "yw-look.exe",
);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const args = process.argv.slice(2);

const MANUAL_CHECKS_REMAINING = [
  {
    id: "nsis-loader-pack-ui",
    label: "NSIS Optional Loader Packs UI (interactive install ON/OFF)",
    reason:
      "Static and bundle checks do not prove the installer selection page or post-install manifest state.",
  },
  {
    id: "windows-smartscreen",
    label: "Windows SmartScreen on a clean machine",
    reason:
      "Authenticode audit records signature status only; SmartScreen reputation is manual.",
  },
  {
    id: "windows-authenticode-production",
    label: "Production Authenticode signing (--require-signed gate)",
    reason:
      "Default preflight audits unsigned bundles without failing; production signing is separate.",
  },
  {
    id: "macos-notarization-gatekeeper",
    label: "macOS notarization, stapler, and Gatekeeper on a clean Mac",
    reason:
      "Default preflight audits local bundles without --require-verified; Finder Open With and quarantine-free launch are manual.",
  },
  {
    id: "github-release-install-updater-roundtrip",
    label: "GitHub Release install and updater roundtrip (Windows and macOS)",
    reason:
      "Manifest and local feed checks do not prove install → update success on published artifacts.",
  },
];

function printHelp() {
  console.log(`Usage: node scripts/run-release-preflight.mjs [options]

Run a curated local release preflight before tagging. Cheap checks run by default;
optional flags add heavier or artifact-dependent gates.

Default automatic checks:
  npm run check:readme-screenshot
  npm run check:nsis-loader-packs
  npm run check:file-associations
  npm run test:release-updater-config
  npm run check:macos-codesign        (skipped off macOS)
  npm run check:win-authenticode      (skipped off Windows)

Options:
  --tag <vX.Y.Z>              Also run npm run release:notes:check for the tag
  --include-heavy             Also run npm run check (lint, format, tests, typecheck)
  --include-bundle            Also run npm run check:nsis-loader-pack-bundle
  --include-local-update      Also run check:update-feed and smoke:update-feed
  --release-manifest <path>   Run check:release-updater with --manifest and --skip-url-check
  --release-url <url>         Run check:release-updater with --url
  --release-binary <path>     Verify compiled official endpoint/key and the supplied release manifest/URL
  --json                      Print JSON report only to stdout
  --help, -h                  Show this help

Outputs:
  artifacts/logs/release-preflight-report.json
  artifacts/logs/release-preflight-report.md

Exit code:
  0 when every executed step passes
  1 when any executed step fails (skipped steps never fail the run)

This command does not complete a release. Manual install, signing, notarization,
SmartScreen, Gatekeeper, and published updater roundtrip checks remain operator-owned.`);
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function toRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function parseOptions() {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printHelp();
    process.exit(0);
  }

  const tag = readOption(args, "--tag");
  const releaseManifest = readOption(args, "--release-manifest");
  const releaseUrl =
    readOption(args, "--release-url") ?? readOption(args, "--url");
  const releaseBinary = readOption(args, "--release-binary");
  if (
    releaseBinary &&
    Number(Boolean(releaseManifest)) + Number(Boolean(releaseUrl)) !== 1
  ) {
    throw new Error(
      "--release-binary requires exactly one of --release-manifest or --release-url",
    );
  }

  const valueOptions = new Set([
    "--tag",
    "--release-manifest",
    "--release-url",
    "--release-binary",
    "--url",
  ]);
  const flagOptions = new Set([
    "--include-heavy",
    "--include-bundle",
    "--include-local-update",
    "--json",
    "--help",
    "-h",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (valueOptions.has(token)) {
      index += 1;
      continue;
    }
    if (flagOptions.has(token)) continue;
    throw new Error(`unknown argument: ${token}`);
  }

  return {
    tag,
    includeHeavy: hasFlag(args, "--include-heavy"),
    includeBundle: hasFlag(args, "--include-bundle"),
    includeLocalUpdate: hasFlag(args, "--include-local-update"),
    releaseManifest,
    releaseUrl,
    releaseBinary,
    jsonOnly: hasFlag(args, "--json"),
  };
}

function directoryHasEntry(directoryPath, predicate) {
  if (!fs.existsSync(directoryPath)) {
    return false;
  }
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .some((entry) => predicate(entry, path.join(directoryPath, entry.name)));
}

function hasWindowsSigningArtifacts() {
  return (
    fs.existsSync(windowsMainBinary) ||
    directoryHasEntry(
      path.join(bundleRoot, "nsis"),
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"),
    )
  );
}

function hasMacosSigningArtifacts() {
  return (
    directoryHasEntry(
      path.join(bundleRoot, "macos"),
      (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
    ) ||
    directoryHasEntry(
      path.join(bundleRoot, "dmg"),
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dmg"),
    ) ||
    directoryHasEntry(
      path.join(bundleRoot, "macos"),
      (entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith(".app.tar.gz"),
    )
  );
}

function buildStepDefinitions(options) {
  const steps = [
    {
      id: "release-updater-config-contract",
      label: "Release updater configuration contract",
      command: "npm run test:release-updater-config",
      npmArgs: ["run", "test:release-updater-config"],
      category: "automatic",
    },
    {
      id: "readme-screenshot",
      label: "README native UI screenshot freshness",
      command: "npm run check:readme-screenshot",
      npmArgs: ["run", "check:readme-screenshot"],
      category: "automatic",
    },
    {
      id: "nsis-loader-packs",
      label: "NSIS loader pack hooks",
      command: "npm run check:nsis-loader-packs",
      npmArgs: ["run", "check:nsis-loader-packs"],
      category: "automatic",
    },
    {
      id: "file-associations",
      label: "File associations contract",
      command: "npm run check:file-associations",
      npmArgs: ["run", "check:file-associations"],
      category: "automatic",
    },
    {
      id: "macos-codesign",
      label: "macOS codesign audit",
      command: "npm run check:macos-codesign",
      npmArgs: ["run", "check:macos-codesign"],
      category: "automatic",
      skipUnless: () => {
        if (process.platform !== "darwin") {
          return "macOS codesign audit requires macOS.";
        }
        if (!hasMacosSigningArtifacts()) {
          return "No macOS bundle artifacts found; run bundle:mac before auditing signing/notarization status.";
        }
        return null;
      },
    },
    {
      id: "win-authenticode",
      label: "Windows Authenticode audit",
      command: "npm run check:win-authenticode",
      npmArgs: ["run", "check:win-authenticode"],
      category: "automatic",
      skipUnless: () => {
        if (process.platform !== "win32") {
          return "Windows Authenticode audit requires Windows.";
        }
        if (!hasWindowsSigningArtifacts()) {
          return "No Windows bundle artifacts found; run bundle:win:loaders before auditing Authenticode status.";
        }
        return null;
      },
    },
  ];

  if (options.tag) {
    steps.push({
      id: "release-notes-contract",
      label: "Release notes contract",
      command: `npm run release:notes:check -- --tag ${options.tag}`,
      npmArgs: ["run", "release:notes:check", "--", "--tag", options.tag],
      category: "automatic",
    });
  } else {
    steps.push({
      id: "release-notes-contract",
      label: "Release notes contract",
      command: "npm run release:notes:check -- --tag <vX.Y.Z>",
      category: "automatic",
      skipReason: "No --tag supplied; release-notes contract not checked.",
    });
  }

  if (options.includeHeavy) {
    steps.push({
      id: "code-quality",
      label: "Code quality gate (lint, format, tests, typecheck)",
      command: "npm run check",
      npmArgs: ["run", "check"],
      category: "optional",
    });
  }

  if (options.includeBundle) {
    steps.push({
      id: "nsis-loader-pack-bundle",
      label: "NSIS loader pack bundle readiness",
      command: "npm run check:nsis-loader-pack-bundle",
      npmArgs: ["run", "check:nsis-loader-pack-bundle"],
      category: "optional",
    });
  }

  if (options.includeLocalUpdate) {
    steps.push(
      {
        id: "local-update-feed",
        label: "Local update feed consistency",
        command: "npm run check:update-feed",
        npmArgs: ["run", "check:update-feed"],
        category: "optional",
      },
      {
        id: "local-update-feed-smoke",
        label: "Local update feed HTTP smoke",
        command: "npm run smoke:update-feed",
        npmArgs: ["run", "smoke:update-feed"],
        category: "optional",
      },
    );
  }

  if (options.releaseBinary) {
    const sourceArgs = options.releaseManifest
      ? ["--manifest", options.releaseManifest]
      : ["--url", options.releaseUrl];
    steps.push({
      id: "release-updater-binary",
      label: "Compiled official updater settings and release manifest",
      command: `npm run check:release-updater-config -- --binary ${options.releaseBinary} ${sourceArgs.join(" ")}`,
      nodeArgs: [
        path.join(scriptDir, "check-release-updater-config.mjs"),
        "--binary",
        options.releaseBinary,
        ...sourceArgs,
      ],
      category: "optional",
    });
  }

  if (options.releaseManifest && !options.releaseBinary) {
    steps.push({
      id: "release-updater-manifest",
      label: "Release updater manifest contract",
      command: `npm run check:release-updater -- --manifest ${options.releaseManifest} --skip-url-check`,
      npmArgs: [
        "run",
        "check:release-updater",
        "--",
        "--manifest",
        options.releaseManifest,
        "--skip-url-check",
      ],
      category: "optional",
    });
  }

  if (options.releaseUrl && !options.releaseBinary) {
    steps.push({
      id: "release-updater-url",
      label: "Release updater manifest URL",
      command: `npm run check:release-updater -- --url ${options.releaseUrl}`,
      npmArgs: [
        "run",
        "check:release-updater",
        "--",
        "--url",
        options.releaseUrl,
      ],
      category: "optional",
    });
  }

  return steps;
}

async function runNpmStep(step, { forwardOutput = false } = {}) {
  const preSkipReason = step.skipReason ?? step.skipUnless?.() ?? null;
  if (preSkipReason) {
    return {
      ...step,
      status: "skipped",
      exitCode: null,
      durationMs: 0,
      skipReason: preSkipReason,
      error: null,
    };
  }

  const result = await runChildProcess(
    step.nodeArgs ? process.execPath : npmCmd,
    step.nodeArgs ?? step.npmArgs,
    {
      cwd: repoRoot,
      shell: !step.nodeArgs && process.platform === "win32",
      windowsHide: true,
      forwardStdout: forwardOutput,
      forwardStderr: forwardOutput,
    },
  );

  const exitCode = result.exitCode;
  const failed = exitCode !== 0;

  return {
    ...step,
    status: failed ? "failed" : "passed",
    exitCode,
    durationMs: result.durationMs,
    skipReason: null,
    error: result.error,
  };
}

function summarizeSteps(steps) {
  return steps.reduce(
    (summary, step) => {
      summary.total += 1;
      if (step.status === "passed") summary.passed += 1;
      if (step.status === "failed") summary.failed += 1;
      if (step.status === "skipped") summary.skipped += 1;
      if (step.status !== "skipped") summary.executed += 1;
      return summary;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0, executed: 0 },
  );
}

function buildReport(options, steps) {
  const summary = summarizeSteps(steps);
  const automaticSteps = steps.filter((step) => step.category === "automatic");
  const optionalSteps = steps.filter((step) => step.category === "optional");
  const automaticSummary = summarizeSteps(automaticSteps);
  const failedExecuted = steps.some((step) => step.status === "failed");

  return {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    tag: options.tag,
    options: {
      includeHeavy: options.includeHeavy,
      includeBundle: options.includeBundle,
      includeLocalUpdate: options.includeLocalUpdate,
      releaseManifest: options.releaseManifest,
      releaseUrl: options.releaseUrl,
    },
    summary,
    automaticSummary,
    optionalSummary: summarizeSteps(optionalSteps),
    steps: steps.map((step) => ({
      id: step.id,
      label: step.label,
      category: step.category,
      command: step.command,
      status: step.status,
      exitCode: step.exitCode,
      durationMs: step.durationMs,
      skipReason: step.skipReason,
      error: step.error,
    })),
    manualChecksRemaining: MANUAL_CHECKS_REMAINING,
    preflightPassed: !failedExecuted,
    releaseComplete: false,
    releaseCompleteNote:
      "Automatic preflight success does not mark the release complete. Operator-owned install, signing, notarization, SmartScreen, Gatekeeper, and updater roundtrip checks remain required.",
  };
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function buildMarkdownReport(report) {
  const lines = [
    "# Release preflight report",
    "",
    `- Timestamp: ${report.timestamp}`,
    `- Platform: ${report.platform}`,
    `- Tag: ${report.tag ?? "(not supplied)"}`,
    `- Automatic preflight: ${report.preflightPassed ? "passed" : "failed"}`,
    `- Release complete: no — manual/external checks remain`,
    "",
    "## Automatic checks",
    "",
    "| Step | Command | Status | Exit | Duration | Notes |",
    "| --- | --- | --- | ---: | ---: | --- |",
  ];

  for (const step of report.steps.filter(
    (entry) => entry.category === "automatic",
  )) {
    const notes =
      step.status === "skipped" ? (step.skipReason ?? "") : (step.error ?? "");
    lines.push(
      `| ${step.label} | \`${step.command}\` | ${step.status} | ${step.exitCode ?? "—"} | ${formatDuration(step.durationMs)} | ${notes.replaceAll("|", "\\|")} |`,
    );
  }

  const optionalSteps = report.steps.filter(
    (entry) => entry.category === "optional",
  );
  if (optionalSteps.length > 0) {
    lines.push("", "## Optional checks", "");
    lines.push(
      "| Step | Command | Status | Exit | Duration | Notes |",
      "| --- | --- | --- | ---: | ---: | --- |",
    );
    for (const step of optionalSteps) {
      const notes =
        step.status === "skipped"
          ? (step.skipReason ?? "")
          : (step.error ?? "");
      lines.push(
        `| ${step.label} | \`${step.command}\` | ${step.status} | ${step.exitCode ?? "—"} | ${formatDuration(step.durationMs)} | ${notes.replaceAll("|", "\\|")} |`,
      );
    }
  }

  lines.push(
    "",
    "## Summary",
    "",
    `- Executed: ${report.summary.executed}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Skipped: ${report.summary.skipped}`,
    "",
    "## Manual / external checks still required",
    "",
    "This preflight does **not** replace:",
    "",
    "- NSIS Optional Loader Packs interactive installer UI verification",
    "- Windows Authenticode production signing or SmartScreen behavior on a clean machine",
    "- macOS notarization, stapler, Gatekeeper, or Finder `Open With` on a clean Mac",
    "- Published GitHub Release install → updater roundtrip on Windows and macOS",
    "",
  );

  for (const manualCheck of report.manualChecksRemaining) {
    lines.push(`- **${manualCheck.label}** — ${manualCheck.reason}`);
  }

  lines.push(
    "",
    report.releaseCompleteNote,
    "",
    `JSON report: ${toRelative(jsonReportPath)}`,
  );

  return `${lines.join("\n")}\n`;
}

function writeReports(report) {
  ensureDir(reportDir);
  fs.writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownReportPath, buildMarkdownReport(report));
}

function printHumanSummary(report) {
  console.log("Release preflight");
  console.log(`Tag: ${report.tag ?? "(not supplied)"}`);
  console.log(
    `Automatic: ${report.automaticSummary.passed} passed, ${report.automaticSummary.failed} failed, ${report.automaticSummary.skipped} skipped`,
  );
  if (report.optionalSummary.total > 0) {
    console.log(
      `Optional: ${report.optionalSummary.passed} passed, ${report.optionalSummary.failed} failed, ${report.optionalSummary.skipped} skipped`,
    );
  }

  for (const step of report.steps) {
    const duration = formatDuration(step.durationMs);
    const suffix =
      step.status === "skipped"
        ? ` — ${step.skipReason}`
        : step.status === "failed" && step.error
          ? ` — ${step.error}`
          : "";
    console.log(`[${step.status}] ${step.label} (${duration})${suffix}`);
  }

  console.log("");
  console.log(
    report.preflightPassed
      ? "Automatic preflight passed."
      : "Automatic preflight failed.",
  );
  console.log(
    "Release is not complete until manual install, signing, notarization, SmartScreen, Gatekeeper, and updater roundtrip checks are recorded.",
  );
  console.log(`JSON report: ${toRelative(jsonReportPath)}`);
  console.log(`Markdown report: ${toRelative(markdownReportPath)}`);
}

async function main() {
  const options = parseOptions();
  const stepDefinitions = buildStepDefinitions(options);
  const steps = [];

  for (const step of stepDefinitions) {
    const preSkipReason = step.skipReason ?? step.skipUnless?.() ?? null;
    if (!options.jsonOnly && !preSkipReason) {
      process.stdout.write(`\n--- ${step.label} (${step.command}) ---\n`);
    }
    const result = await runNpmStep(step, {
      forwardOutput: !options.jsonOnly && !preSkipReason,
    });
    steps.push(result);
  }

  const report = buildReport(options, steps);
  writeReports(report);

  if (options.jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("");
    printHumanSummary(report);
  }

  return report.preflightPassed ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
