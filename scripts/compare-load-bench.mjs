import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultBaselinePath = path.join(
  repoRoot,
  "artifacts",
  "bench",
  "load-baseline.json",
);

const args = process.argv.slice(2);
const usage = `usage:
  npm run bench:load:baseline
  npm run bench:load:baseline -- --report <artifacts/bench/.../report.json> --out <baseline.json>
  npm run bench:load:compare
  npm run bench:load:compare -- --baseline <baseline.json> --report <report.json>

Defaults:
  --report    latest artifacts/bench/*/report.json
  --baseline  artifacts/bench/load-baseline.json`;

const loadTimeRatio = Number(readOption("--load-ratio") ?? 1.35);
const loadTimeSlackMs = Number(readOption("--load-slack-ms") ?? 250);
const frameP95Ratio = Number(readOption("--frame-p95-ratio") ?? 1.2);
const frameP95SlackMs = Number(readOption("--frame-p95-slack-ms") ?? 2);
const writeBaselinePath = readOption("--write-baseline") ?? readOption("--out");
const baselinePath = path.resolve(
  repoRoot,
  readOption("--baseline") ?? defaultBaselinePath,
);

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

async function latestReportPath() {
  const benchRoot = path.join(repoRoot, "artifacts", "bench");
  const entries = await readdir(benchRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(benchRoot, entry.name, "report.json"))
    .sort()
    .reverse();

  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // Keep looking; stale artifact directories may not contain a report.
    }
  }

  throw new Error("no bench report found under artifacts/bench");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function metricThreshold(value, ratio, slack) {
  if (typeof value !== "number") return null;
  return Math.round((value * ratio + slack) * 100) / 100;
}

function buildBaseline(report) {
  const cases = Object.fromEntries(
    report.cases.map((benchCase) => [
      benchCase.id,
      {
        name: benchCase.name,
        path: benchCase.path,
        ext: benchCase.ext,
        shouldLoad: benchCase.shouldLoad,
        minMeshCount: benchCase.minMeshCount,
        loadTimeMs: benchCase.loadTimeMs,
        frameTimeP95Ms: benchCase.frameTimeMs?.p95 ?? null,
        rendererMemory: benchCase.rendererInfo?.memory ?? null,
        renderCalls: benchCase.rendererInfo?.render?.calls ?? null,
      },
    ]),
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceReport: repoRelative(path.resolve(report.outDir, "report.json")),
    appVersion: report.appVersion,
    platform: {
      os: report.os,
      arch: report.arch,
      nodeVersion: report.nodeVersion,
    },
    thresholds: {
      loadTimeRatio,
      loadTimeSlackMs,
      frameP95Ratio,
      frameP95SlackMs,
    },
    cases,
  };
}

function compareReport(baseline, report) {
  const findings = [];
  const casesById = new Map(
    report.cases.map((benchCase) => [benchCase.id, benchCase]),
  );

  for (const [id, baseCase] of Object.entries(baseline.cases)) {
    const current = casesById.get(id);
    if (!current) {
      findings.push({
        level: "fail",
        id,
        metric: "case",
        message: "case missing from current report",
      });
      continue;
    }

    if (current.loaded !== baseCase.shouldLoad) {
      findings.push({
        level: "fail",
        id,
        metric: "loaded",
        baseline: baseCase.shouldLoad,
        current: current.loaded,
        message: "load expectation changed",
      });
    }
    if (baseCase.shouldLoad && !current.nonBlankCanvas) {
      findings.push({
        level: "fail",
        id,
        metric: "nonBlankCanvas",
        current: false,
        message: "canvas was blank",
      });
    }
    if (current.consoleErrors > 0 || current.error) {
      findings.push({
        level: "fail",
        id,
        metric: "error",
        current: current.error ?? `${current.consoleErrors} console errors`,
        message: "bench case reported errors",
      });
    }
    if (current.meshCount < baseCase.minMeshCount) {
      findings.push({
        level: "fail",
        id,
        metric: "meshCount",
        baseline: baseCase.minMeshCount,
        current: current.meshCount,
        message: "mesh count fell below expectation",
      });
    }

    const loadLimit = metricThreshold(
      baseCase.loadTimeMs,
      baseline.thresholds.loadTimeRatio,
      baseline.thresholds.loadTimeSlackMs,
    );
    if (
      loadLimit !== null &&
      typeof current.loadTimeMs === "number" &&
      current.loadTimeMs > loadLimit
    ) {
      findings.push({
        level: "fail",
        id,
        metric: "loadTimeMs",
        baseline: baseCase.loadTimeMs,
        current: current.loadTimeMs,
        limit: loadLimit,
        message: "load time exceeded threshold",
      });
    }

    const frameLimit = metricThreshold(
      baseCase.frameTimeP95Ms,
      baseline.thresholds.frameP95Ratio,
      baseline.thresholds.frameP95SlackMs,
    );
    const currentFrameP95 = current.frameTimeMs?.p95 ?? null;
    if (
      frameLimit !== null &&
      typeof currentFrameP95 === "number" &&
      currentFrameP95 > frameLimit
    ) {
      findings.push({
        level: "fail",
        id,
        metric: "frameTimeP95Ms",
        baseline: baseCase.frameTimeP95Ms,
        current: currentFrameP95,
        limit: frameLimit,
        message: "frame p95 exceeded threshold",
      });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: baseline.sourceReport ?? repoRelative(baselinePath),
    report: repoRelative(path.resolve(report.outDir, "report.json")),
    summary: {
      total: Object.keys(baseline.cases).length,
      failed: findings.length,
    },
    findings,
  };
}

function renderComparison(comparison) {
  if (comparison.findings.length === 0) {
    return `Bench comparison passed: ${comparison.summary.total} cases checked.`;
  }

  const lines = [
    `Bench comparison failed: ${comparison.findings.length} finding(s).`,
  ];
  for (const finding of comparison.findings) {
    lines.push(
      `- ${finding.id} ${finding.metric}: ${finding.message}` +
        (finding.limit !== undefined
          ? ` (current ${finding.current}, limit ${finding.limit}, baseline ${finding.baseline})`
          : ""),
    );
  }
  return lines.join("\n");
}

const reportPath = path.resolve(
  repoRoot,
  readOption("--report") ?? (await latestReportPath()),
);
const report = await readJson(reportPath);

if (writeBaselinePath) {
  const outPath = path.resolve(repoRoot, writeBaselinePath);
  await writeFile(
    outPath,
    JSON.stringify(buildBaseline(report), null, 2),
    "utf8",
  );
  console.log(`Wrote bench baseline: ${repoRelative(outPath)}`);
  process.exit(0);
}

const baseline = await readJson(baselinePath);
const comparison = compareReport(baseline, report);
const comparisonPath = path.join(path.dirname(reportPath), "comparison.json");
await writeFile(comparisonPath, JSON.stringify(comparison, null, 2), "utf8");
console.log(renderComparison(comparison));
console.log(`Comparison report: ${repoRelative(comparisonPath)}`);
process.exit(comparison.summary.failed > 0 ? 1 : 0);
