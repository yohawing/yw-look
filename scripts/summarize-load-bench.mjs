import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasFlag, readOption } from "./cliArgs.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const REPRESENTATIVE_CASE_IDS = ["pixar-kitchen-set"];

const args = process.argv.slice(2);
const usage = `usage:
  npm run bench:load:summary
  npm run bench:load:summary -- --report <artifacts/bench/.../report.json>
  npm run bench:load:summary -- --allow-empty

Defaults:
  --report    latest artifacts/bench/*/report.json

Writes heavy-load-summary.json and heavy-load-summary.md next to the source
report. Exits non-zero when the report has no heavy or representative cases
unless --allow-empty is set.`;

if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
  console.log(usage);
  process.exit(0);
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

function isHeavyOrRepresentative(benchCase) {
  const tags = benchCase.tags ?? [];
  if (tags.includes("heavy")) {
    return true;
  }
  return REPRESENTATIVE_CASE_IDS.includes(benchCase.id);
}

function summarizeCase(benchCase) {
  const summary = {
    id: benchCase.id,
    name: benchCase.name,
    ext: benchCase.ext,
    path: benchCase.path,
    tags: benchCase.tags ?? [],
    loaded: benchCase.loaded,
    nonBlankCanvas: benchCase.nonBlankCanvas,
    meshCount: benchCase.meshCount,
    openPipelineMs: benchCase.openPipelineMs ?? null,
    loadTimeMs: benchCase.loadTimeMs ?? null,
    textureReadyMs: benchCase.textureReadyMs ?? null,
    deferredTextureMs: benchCase.deferredTextureMs ?? null,
    deferredTextureCounts: benchCase.deferredTextureCounts ?? null,
    screenshot: benchCase.screenshot ?? null,
    error: benchCase.error ?? null,
    consoleErrors: benchCase.consoleErrors ?? 0,
  };

  if (benchCase.loadResponsiveness) {
    summary.loadResponsiveness = {
      maxGapMs: benchCase.loadResponsiveness.maxGapMs ?? null,
    };
  }

  if (benchCase.frameTimeMs) {
    summary.frameTimeMs = {
      p95: benchCase.frameTimeMs.p95 ?? null,
    };
  }

  if (benchCase.rendererInfo) {
    summary.rendererInfo = {
      memory: benchCase.rendererInfo.memory ?? null,
      render: benchCase.rendererInfo.render ?? null,
    };
  }

  return summary;
}

function caseHasFailure(benchCase) {
  return (
    benchCase.loaded === false ||
    benchCase.nonBlankCanvas === false ||
    benchCase.error ||
    (benchCase.consoleErrors ?? 0) > 0
  );
}

function buildSummary(report, sourceReportPath) {
  const matchedCases = report.cases.filter(isHeavyOrRepresentative);
  const summarizedCases = matchedCases.map(summarizeCase);
  const failures = matchedCases.filter(caseHasFailure);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceReport: repoRelative(sourceReportPath),
    coversHeavyRealAssets: matchedCases.length > 0,
    reportMetadata: {
      generatedAt: report.generatedAt ?? null,
      appVersion: report.appVersion ?? null,
      os: report.os ?? null,
      arch: report.arch ?? null,
      nodeVersion: report.nodeVersion ?? null,
      caseIds: report.caseIds ?? [],
      totalCasesInReport: report.cases.length,
    },
    filter: {
      heavyTag: true,
      representativeCaseIds: REPRESENTATIVE_CASE_IDS,
    },
    summary: {
      totalInReport: report.cases.length,
      matched: matchedCases.length,
      loaded: matchedCases.filter((benchCase) => benchCase.loaded).length,
      nonBlank: matchedCases.filter((benchCase) => benchCase.nonBlankCanvas)
        .length,
      failed: failures.length,
    },
    cases: summarizedCases,
  };
}

function formatRendererMemory(memory) {
  if (!memory) {
    return "n/a";
  }
  const parts = [];
  if (typeof memory.geometries === "number") {
    parts.push(`geometries=${memory.geometries}`);
  }
  if (typeof memory.textures === "number") {
    parts.push(`textures=${memory.textures}`);
  }
  return parts.length > 0 ? parts.join(", ") : "n/a";
}

function formatRendererRender(render) {
  if (!render) {
    return "n/a";
  }
  const parts = [];
  if (typeof render.calls === "number") {
    parts.push(`calls=${render.calls}`);
  }
  if (typeof render.triangles === "number") {
    parts.push(`triangles=${render.triangles}`);
  }
  return parts.length > 0 ? parts.join(", ") : "n/a";
}

function renderMarkdown(summary) {
  const lines = [
    "# Heavy Real-Asset Load Bench Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    `Source report: \`${summary.sourceReport}\``,
    "",
    "## Coverage",
    "",
  ];

  if (summary.coversHeavyRealAssets) {
    lines.push(
      "This summary covers heavy or representative real assets from the source report.",
    );
  } else {
    lines.push(
      "This source report does **not** cover heavy or representative real assets.",
    );
    lines.push(
      "Run a heavy case such as `bistro-interior` or `pixar-kitchen-set` before treating this as a heavy benchmark record.",
    );
  }

  lines.push(
    "",
    "## Report Metadata",
    "",
    `- App version: ${summary.reportMetadata.appVersion ?? "unknown"}`,
    `- Platform: ${summary.reportMetadata.os ?? "unknown"} / ${summary.reportMetadata.arch ?? "unknown"}`,
    `- Node: ${summary.reportMetadata.nodeVersion ?? "unknown"}`,
    `- Report generated: ${summary.reportMetadata.generatedAt ?? "unknown"}`,
    `- Cases in source report: ${summary.reportMetadata.totalCasesInReport}`,
    `- Matched heavy/representative cases: ${summary.summary.matched}`,
    `- Loaded: ${summary.summary.loaded}`,
    `- Non-blank canvas: ${summary.summary.nonBlank}`,
    `- Failed: ${summary.summary.failed}`,
    "",
    "## Matched Cases",
    "",
    "| ID | Loaded | Shell-ready ms | Texture-ready ms | Deferred ms | Textures loaded/failed/total | Open pipeline ms | Max gap ms | Frame p95 ms | Mesh count |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const benchCase of summary.cases) {
    lines.push(
      `| ${benchCase.id} | ${benchCase.loaded ? "yes" : "no"} | ${benchCase.loadTimeMs ?? "n/a"} | ${benchCase.textureReadyMs ?? "n/a"} | ${benchCase.deferredTextureMs ?? "n/a"} | ${benchCase.deferredTextureCounts ? `${benchCase.deferredTextureCounts.loaded}/${benchCase.deferredTextureCounts.failed}/${benchCase.deferredTextureCounts.total}` : "n/a"} | ${benchCase.openPipelineMs ?? "n/a"} | ${benchCase.loadResponsiveness?.maxGapMs ?? "n/a"} | ${benchCase.frameTimeMs?.p95 ?? "n/a"} | ${benchCase.meshCount ?? "n/a"} |`,
    );
  }

  if (summary.cases.length === 0) {
    lines.push("| _none_ | | | | | | | | | |");
  }

  lines.push("", "## Case Details", "");

  for (const benchCase of summary.cases) {
    lines.push(`### ${benchCase.id}`, "");
    lines.push(`- Name: ${benchCase.name}`);
    lines.push(`- Path: \`${benchCase.path}\``);
    lines.push(`- Ext: ${benchCase.ext}`);
    lines.push(`- Tags: ${benchCase.tags.join(", ") || "none"}`);
    lines.push(`- Loaded: ${benchCase.loaded ? "yes" : "no"}`);
    lines.push(
      `- Non-blank canvas: ${benchCase.nonBlankCanvas ? "yes" : "no"}`,
    );
    lines.push(`- Mesh count: ${benchCase.meshCount ?? "n/a"}`);
    lines.push(`- Open pipeline ms: ${benchCase.openPipelineMs ?? "n/a"}`);
    lines.push(`- Load time ms: ${benchCase.loadTimeMs ?? "n/a"}`);
    lines.push(`- Texture-ready ms: ${benchCase.textureReadyMs ?? "n/a"}`);
    lines.push(
      `- Deferred texture ms: ${benchCase.deferredTextureMs ?? "n/a"}`,
    );
    lines.push(
      `- Deferred textures loaded/failed/total: ${benchCase.deferredTextureCounts ? `${benchCase.deferredTextureCounts.loaded}/${benchCase.deferredTextureCounts.failed}/${benchCase.deferredTextureCounts.total}` : "n/a"}`,
    );
    lines.push(
      `- Load responsiveness max gap ms: ${benchCase.loadResponsiveness?.maxGapMs ?? "n/a"}`,
    );
    lines.push(`- Frame p95 ms: ${benchCase.frameTimeMs?.p95 ?? "n/a"}`);
    lines.push(
      `- Renderer memory: ${formatRendererMemory(benchCase.rendererInfo?.memory)}`,
    );
    lines.push(
      `- Renderer render: ${formatRendererRender(benchCase.rendererInfo?.render)}`,
    );
    if (benchCase.screenshot) {
      lines.push(`- Screenshot: \`${benchCase.screenshot}\``);
    }
    if (benchCase.error) {
      lines.push(`- Error: ${benchCase.error}`);
    }
    if ((benchCase.consoleErrors ?? 0) > 0) {
      lines.push(`- Console errors: ${benchCase.consoleErrors}`);
    }
    lines.push("");
  }

  const failures = summary.cases.filter(caseHasFailure);

  if (failures.length > 0) {
    lines.push("## Failures And Errors", "");
    for (const benchCase of failures) {
      lines.push(`### ${benchCase.id}`, "");
      if (benchCase.loaded === false) {
        lines.push("- Load failed.");
      }
      if (benchCase.nonBlankCanvas === false) {
        lines.push("- Canvas was blank.");
      }
      if (benchCase.error) {
        lines.push(`- Error: ${benchCase.error}`);
      }
      if ((benchCase.consoleErrors ?? 0) > 0) {
        lines.push(`- Console errors: ${benchCase.consoleErrors}`);
      }
      lines.push("");
    }
  } else if (summary.cases.length === 0) {
    lines.push(
      "## Failures And Errors",
      "",
      "No heavy or representative cases were present.",
      "",
    );
  } else {
    lines.push(
      "## Failures And Errors",
      "",
      "No failures recorded for matched cases.",
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

const allowEmpty = hasFlag(args, "--allow-empty");
const reportPath = path.resolve(
  repoRoot,
  readOption(args, "--report") ?? (await latestReportPath()),
);
const report = await readJson(reportPath);
const summary = buildSummary(report, reportPath);

if (summary.summary.matched === 0 && !allowEmpty) {
  console.error(
    `No heavy or representative cases found in ${repoRelative(reportPath)}.`,
  );
  console.error(
    "Run a heavy case such as bistro-interior or pixar-kitchen-set, or pass --allow-empty to write an empty summary.",
  );
  process.exit(1);
}

const outDir = path.dirname(reportPath);
const jsonPath = path.join(outDir, "heavy-load-summary.json");
const markdownPath = path.join(outDir, "heavy-load-summary.md");

await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");
await writeFile(markdownPath, renderMarkdown(summary), "utf8");

console.log(
  `Wrote heavy load summary for ${summary.summary.matched} matched case(s).`,
);
console.log(`JSON: ${repoRelative(jsonPath)}`);
console.log(`Markdown: ${repoRelative(markdownPath)}`);

if (summary.summary.matched === 0) {
  console.log("Source report had no heavy or representative cases.");
}

process.exit(0);
