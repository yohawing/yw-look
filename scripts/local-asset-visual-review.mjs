import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const defaultCsv = path.join(
  repoRoot,
  "artifacts",
  "local-assets",
  "3dcg-assets.csv",
);
const defaultOutDir = path.join(
  repoRoot,
  "artifacts",
  "local-assets",
  "visual-review",
);

const argv = parseArgs(process.argv.slice(2));

if (argv.help) {
  printUsage();
  process.exit(0);
}

const csvPath = path.resolve(repoRoot, argv.csv ?? defaultCsv);
const outDir = path.resolve(repoRoot, argv.out ?? defaultOutDir);
const screenshotDir = path.join(outDir, "screenshots");
const selectedId = argv.case ?? null;
const limit = argv.limit === undefined ? null : Number(argv.limit);
const offset = argv.offset === undefined ? 0 : Number(argv.offset);
const size = argv.size ?? "640x480";
const background = argv.bg ?? "default";
const timeoutMs =
  argv.timeoutMs === undefined ? 600_000 : Number(argv.timeoutMs);
const includeKinds = argv.kinds
  ? new Set(
      argv.kinds
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
  : new Set(["model", "splat"]);

if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
  throw new Error("--limit must be a positive number");
}
if (!Number.isInteger(offset) || offset < 0) {
  throw new Error("--offset must be a non-negative integer");
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeout-ms must be a positive number");
}

const { width, height } = parseSize(size);
const rows = parseCsv(await readFile(csvPath, "utf8"))
  .map(normalizeRow)
  .filter((row) => row.enabled)
  .filter((row) => includeKinds.has(row.kind));

let cases = selectedId ? rows.filter((row) => row.id === selectedId) : rows;
if (selectedId && cases.length === 0) {
  throw new Error(`unknown CSV case: ${selectedId}`);
}
if (!selectedId && offset > 0) {
  cases = cases.slice(offset);
}
if (limit !== null) {
  cases = cases.slice(0, limit);
}

await mkdir(screenshotDir, { recursive: true });

const shotCases = cases.map((testCase, index) => ({
  inputPath: testCase.path,
  outputPath: path.join(
    screenshotDir,
    `${String(index + 1).padStart(3, "0")}-${sanitizeFileStem(testCase.id)}.png`,
  ),
  width,
  height,
  background,
}));

const configPath = path.join(outDir, "shot-batch-config.json");
await writeFile(configPath, `${JSON.stringify(shotCases, null, 2)}\n`, "utf8");

console.log(
  `[visual-review] rendering ${shotCases.length} screenshot(s) at ${width}x${height}`,
);
let htmlReportPath = path.join(outDir, "visual-review.html");
const devServer = await ensureDevServer();
try {
  const run = await runShotBatch(configPath);

  const results = [];
  for (const [index, testCase] of cases.entries()) {
    const outputPath = shotCases[index].outputPath;
    const image = await inspectPng(outputPath);
    results.push({
      ...publicCaseFields(testCase),
      screenshotPath: image.exists ? normalizeRepoPath(outputPath) : null,
      screenshotUrl: image.exists
        ? normalizePath(path.relative(outDir, outputPath))
        : null,
      visualStatus: image.exists
        ? image.nonBlank
          ? "rendered"
          : "blank"
        : "missing",
      image,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    csv: csvPath,
    reportSchemaVersion: 1,
    filters: {
      kinds: [...includeKinds].sort(),
      case: selectedId,
      offset,
      limit,
      size,
      background,
      timeoutMs,
    },
    run: {
      exitCode: run.exitCode,
      error: run.error,
      stdoutTail: tail(run.stdout),
      stderrTail: tail(run.stderr),
    },
    summary: summarize(results),
    results,
  };

  const jsonReportPath = path.join(outDir, "visual-review-report.json");
  htmlReportPath = path.join(outDir, "visual-review.html");
  const markdownReportPath = path.join(outDir, "visual-review.md");
  await writeFile(
    jsonReportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(markdownReportPath, renderMarkdown(report), "utf8");
  await writeFile(htmlReportPath, renderHtml(report), "utf8");

  console.log("=== local-asset-visual-review ===");
  console.log(`Total    : ${report.summary.total}`);
  console.log(`Rendered : ${report.summary.rendered}`);
  console.log(`Blank    : ${report.summary.blank}`);
  console.log(`Missing  : ${report.summary.missing}`);
  console.log(`HTML     : ${htmlReportPath}`);
  console.log(`JSON     : ${jsonReportPath}`);

  process.exitCode = run.exitCode !== 0 || report.summary.missing > 0 ? 1 : 0;
} finally {
  await stopDevServer(devServer);
}

function runShotBatch(configFile) {
  const startedAt = performance.now();
  const runArgs = [
    path.join(repoRoot, "scripts", "run-shot.mjs"),
    "shot-batch",
    "--config-file",
    configFile,
  ];

  return new Promise((resolve) => {
    const child = spawn(process.execPath, runArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        YW_LOOK_CARGO_NO_DEFAULT_FEATURES:
          process.env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES ?? "1",
        YW_LOOK_CARGO_FEATURES:
          process.env.YW_LOOK_CARGO_FEATURES ?? "backend-openusd-rs",
      },
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      resolve({
        exitCode: null,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        error: `timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        error: signal ? `terminated by ${signal}` : null,
      });
    });
  });
}

async function ensureDevServer() {
  const devUrl = "http://127.0.0.1:1420/?entry=shot";
  if (await probeUrl(devUrl)) {
    return null;
  }

  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    if (/error|failed|ready in/i.test(text)) {
      process.stdout.write(text);
    }
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  try {
    await waitForUrl(devUrl, 60_000, child);
  } catch (error) {
    await stopDevServer(child);
    throw error;
  }
  return child;
}

function probeUrl(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function waitForUrl(url, timeoutMs, serverProcess) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      serverProcess?.off("exit", onServerExit);
      serverProcess?.off("error", onServerError);
      callback(value);
    };
    const onServerExit = (code, signal) => {
      const reason =
        signal ?? (code === null ? "unknown status" : `exit code ${code}`);
      finish(reject, new Error(`dev server exited before ready: ${reason}`));
    };
    const onServerError = (error) => {
      finish(reject, error);
    };
    serverProcess?.once("exit", onServerExit);
    serverProcess?.once("error", onServerError);
    const poll = async () => {
      if (await probeUrl(url)) {
        finish(resolve);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        finish(reject, new Error(`dev server did not become ready: ${url}`));
        return;
      }
      setTimeout(poll, 500);
    };
    poll();
  });
}

function stopDevServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) {
    return Promise.resolve();
  }
  if (process.platform === "win32" && serverProcess.pid) {
    return new Promise((resolve) => {
      const child = spawn(
        "taskkill",
        ["/pid", String(serverProcess.pid), "/T", "/F"],
        {
          stdio: "ignore",
          shell: false,
        },
      );
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  }
  serverProcess.kill();
  return Promise.resolve();
}

async function inspectPng(filePath) {
  try {
    await stat(filePath);
    const buffer = await readFile(filePath);
    const decoded = decodePngPixels(buffer);
    const variation = measurePixelVariation(decoded);
    return {
      exists: true,
      width: decoded.width,
      height: decoded.height,
      nonBlank: variation.changedPixelCount > Math.max(16, decoded.width),
      changedPixelCount: variation.changedPixelCount,
      changedPixelRatio:
        Math.round(
          (variation.changedPixelCount / variation.totalPixels) * 10000,
        ) / 10000,
    };
  } catch (error) {
    return {
      exists: false,
      width: null,
      height: null,
      nonBlank: false,
      changedPixelCount: 0,
      changedPixelRatio: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function decodePngPixels(buffer) {
  if (buffer.length < 8 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("not a PNG file");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
  }

  const channelsByColorType = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4],
  ]);
  const channels = channelsByColorType.get(colorType);
  if (!channels) {
    throw new Error(`unsupported PNG color type: ${colorType}`);
  }

  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (stride + 1);
    const filter = inflated[sourceOffset];
    const rowStart = sourceOffset + 1;
    const outputOffset = y * stride;
    const prevOutputOffset = outputOffset - stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[rowStart + x];
      const left = x >= channels ? pixels[outputOffset + x - channels] : 0;
      const up = y > 0 ? pixels[prevOutputOffset + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? pixels[prevOutputOffset + x - channels] : 0;

      switch (filter) {
        case 0:
          pixels[outputOffset + x] = raw;
          break;
        case 1:
          pixels[outputOffset + x] = (raw + left) & 0xff;
          break;
        case 2:
          pixels[outputOffset + x] = (raw + up) & 0xff;
          break;
        case 3:
          pixels[outputOffset + x] = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          pixels[outputOffset + x] =
            (raw + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`unsupported PNG filter: ${filter}`);
      }
    }
  }

  return { width, height, colorType, channels, pixels };
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function measurePixelVariation(decoded) {
  const channels = decoded.channels;
  const first = decoded.pixels.subarray(0, channels);
  let changedPixelCount = 0;
  const totalPixels = decoded.width * decoded.height;

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * channels;
    for (let channel = 0; channel < channels; channel += 1) {
      if (Math.abs(decoded.pixels[offset + channel] - first[channel]) > 2) {
        changedPixelCount += 1;
        break;
      }
    }
  }

  return { changedPixelCount, totalPixels };
}

function renderMarkdown(report) {
  const lines = [
    "# Local Asset Visual Review",
    "",
    `Generated: ${report.generatedAt}`,
    `CSV: \`${report.csv}\``,
    `Size: ${report.filters.size}`,
    "",
    "## Summary",
    "",
    `- Total: ${report.summary.total}`,
    `- Rendered: ${report.summary.rendered}`,
    `- Blank: ${report.summary.blank}`,
    `- Missing: ${report.summary.missing}`,
    "",
    "## Review",
    "",
    "| Visual | Kind | Ext | Screenshot | Source |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${result.visualStatus} | ${result.kind} | ${result.extension} | ${result.screenshotPath ?? ""} | ${result.path} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderHtml(report) {
  const resultJson = JSON.stringify(
    report.results.map((result) => ({
      id: result.id,
      path: result.path,
      extension: result.extension,
      kind: result.kind,
      visualStatus: result.visualStatus,
    })),
  ).replaceAll("</", "<\\/");
  const rows = report.results.map(renderCard).join("\n");
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Asset Visual Review</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0b0d10;
      color: #eef2f7;
    }
    body {
      margin: 0;
      background: #0b0d10;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(11,13,16,.94);
      backdrop-filter: blur(8px);
    }
    .bar {
      max-width: 1440px;
      margin: 0 auto;
      padding: 18px 24px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 20px;
      font-weight: 620;
    }
    .meta, .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      color: #aab4c0;
      font-size: 12px;
    }
    .pill, select, button {
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 6px;
      background: rgba(255,255,255,.04);
      color: #eef2f7;
      padding: 6px 8px;
      font: inherit;
    }
    button {
      cursor: pointer;
    }
    main {
      max-width: 1440px;
      margin: 0 auto;
      padding: 20px 24px 40px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
    }
    article {
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 8px;
      overflow: hidden;
      background: #14181f;
    }
    article[data-review="bad"] {
      border-color: rgba(255,96,96,.65);
    }
    article[data-review="suspect"] {
      border-color: rgba(255,198,87,.65);
    }
    article[data-visual="blank"], article[data-visual="missing"] {
      border-color: rgba(255,96,96,.55);
    }
    .shot {
      display: block;
      width: 100%;
      aspect-ratio: ${width} / ${height};
      object-fit: contain;
      background: #111318;
    }
    .missing-shot {
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: ${width} / ${height};
      color: #ffb4b4;
      background: #211315;
      font-size: 13px;
    }
    .body {
      padding: 10px;
    }
    .title {
      margin: 0 0 8px;
      font-size: 13px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .path {
      margin: 8px 0;
      color: #8d99a8;
      font-size: 11px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
    }
    .badge {
      border-radius: 999px;
      padding: 3px 7px;
      background: rgba(255,255,255,.07);
      color: #cbd5e1;
      font-size: 11px;
      white-space: nowrap;
    }
    .badge.rendered {
      color: #d7f8df;
    }
    .badge.blank, .badge.missing {
      color: #ffd4d4;
    }
    textarea {
      width: 100%;
      min-height: 44px;
      box-sizing: border-box;
      resize: vertical;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 6px;
      background: rgba(0,0,0,.18);
      color: #eef2f7;
      padding: 6px;
      font: inherit;
      font-size: 12px;
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <h1>Local Asset Visual Review</h1>
      <div class="meta">
        <span class="pill">Total ${report.summary.total}</span>
        <span class="pill">Rendered ${report.summary.rendered}</span>
        <span class="pill">Blank ${report.summary.blank}</span>
        <span class="pill">Missing ${report.summary.missing}</span>
        <span class="pill">${escapeHtml(report.filters.size)}</span>
      </div>
      <div class="controls" style="margin-top:10px">
        <label>Visual <select id="visualFilter"><option value="">All</option><option>rendered</option><option>blank</option><option>missing</option></select></label>
        <label>Review <select id="reviewFilter"><option value="">All</option><option value="unreviewed">Unreviewed</option><option value="ok">OK</option><option value="suspect">Suspect</option><option value="bad">Bad</option></select></label>
        <button id="exportButton" type="button">Export review JSON</button>
      </div>
    </div>
  </header>
  <main>
    <section class="grid" id="grid">
${rows}
    </section>
  </main>
  <script>
    const reportResults = ${resultJson};
    const storageKey = "yw-look-local-asset-visual-review:" + location.pathname;
    const state = JSON.parse(localStorage.getItem(storageKey) || "{}");
    function save() {
      localStorage.setItem(storageKey, JSON.stringify(state));
    }
    function applyState(card) {
      const id = card.dataset.id;
      const item = state[id] || {};
      const review = item.review || "unreviewed";
      card.dataset.review = review;
      card.querySelector("[data-role=review]").value = review;
      card.querySelector("[data-role=note]").value = item.note || "";
    }
    function applyFilters() {
      const visual = document.getElementById("visualFilter").value;
      const review = document.getElementById("reviewFilter").value;
      for (const card of document.querySelectorAll("article")) {
        const visualMatch = !visual || card.dataset.visual === visual;
        const reviewMatch = !review || card.dataset.review === review;
        card.classList.toggle("hidden", !(visualMatch && reviewMatch));
      }
    }
    for (const card of document.querySelectorAll("article")) {
      applyState(card);
      card.querySelector("[data-role=review]").addEventListener("change", (event) => {
        const item = state[card.dataset.id] || {};
        item.review = event.target.value;
        state[card.dataset.id] = item;
        card.dataset.review = item.review;
        save();
        applyFilters();
      });
      card.querySelector("[data-role=note]").addEventListener("input", (event) => {
        const item = state[card.dataset.id] || {};
        item.note = event.target.value;
        state[card.dataset.id] = item;
        save();
      });
    }
    document.getElementById("visualFilter").addEventListener("change", applyFilters);
    document.getElementById("reviewFilter").addEventListener("change", applyFilters);
    document.getElementById("exportButton").addEventListener("click", () => {
      const payload = reportResults.map((result) => ({
        ...result,
        review: state[result.id]?.review || "unreviewed",
        note: state[result.id]?.note || ""
      }));
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "visual-review-human-check.json";
      a.click();
      URL.revokeObjectURL(url);
    });
    applyFilters();
  </script>
</body>
</html>
`;
}

function renderCard(result) {
  const image = result.screenshotUrl
    ? `<a href="${escapeHtml(result.screenshotUrl)}"><img class="shot" src="${escapeHtml(result.screenshotUrl)}" loading="lazy" alt="${escapeHtml(result.id)}"></a>`
    : `<div class="missing-shot">No screenshot</div>`;
  return `<article data-id="${escapeHtml(result.id)}" data-visual="${escapeHtml(result.visualStatus)}" data-review="unreviewed">
  ${image}
  <div class="body">
    <h2 class="title">${escapeHtml(result.id)}</h2>
    <div class="row">
      <span class="badge ${escapeHtml(result.visualStatus)}">${escapeHtml(result.visualStatus)}</span>
      <span class="badge">${escapeHtml(result.kind)} / ${escapeHtml(result.extension)}</span>
    </div>
    <p class="path">${escapeHtml(result.path)}</p>
    <div class="row">
      <label>Review <select data-role="review"><option value="unreviewed">Unreviewed</option><option value="ok">OK</option><option value="suspect">Suspect</option><option value="bad">Bad</option></select></label>
      <span class="badge">${Math.round(result.image.changedPixelRatio * 10000) / 100}% changed</span>
    </div>
    <textarea data-role="note" placeholder="review note"></textarea>
  </div>
</article>`;
}

function summarize(results) {
  const summary = {
    total: results.length,
    rendered: 0,
    blank: 0,
    missing: 0,
    byKind: {},
    byExtension: {},
  };
  for (const result of results) {
    summary[result.visualStatus] += 1;
    count(summary.byKind, result.kind);
    count(summary.byExtension, result.extension);
  }
  return summary;
}

function count(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function publicCaseFields(testCase) {
  return {
    id: testCase.id,
    kind: testCase.kind,
    extension: testCase.extension,
    path: testCase.path,
    relativePath: testCase.relativePath,
    bytes: testCase.bytes,
  };
}

function parseSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`invalid --size: ${value}`);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= 0 || height <= 0 || width > 8192 || height > 8192) {
    throw new Error(`invalid --size: ${value}`);
  }
  return { width, height };
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }
  const header = rows[0].map((name) => name.trim());
  return rows
    .slice(1)
    .filter((values) => values.length > 1)
    .map((values) =>
      Object.fromEntries(
        header.map((name, index) => [name, values[index] ?? ""]),
      ),
    );
}

function normalizeRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    extension: row.extension,
    path: path.resolve(row.path),
    relativePath: row.relative_path,
    bytes: Number(row.bytes) || 0,
    enabled: !["0", "false", "no", "off"].includes(
      String(row.enabled ?? "1")
        .trim()
        .toLowerCase(),
    ),
  };
}

function sanitizeFileStem(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function normalizeRepoPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function tail(value, maxLines = 28) {
  return value
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLines)
    .join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
    } else if (token === "--csv") {
      parsed.csv = readValue(tokens, ++index, token);
    } else if (token === "--out") {
      parsed.out = readValue(tokens, ++index, token);
    } else if (token === "--kinds") {
      parsed.kinds = readValue(tokens, ++index, token);
    } else if (token === "--case") {
      parsed.case = readValue(tokens, ++index, token);
    } else if (token === "--offset") {
      parsed.offset = readValue(tokens, ++index, token);
    } else if (token === "--limit") {
      parsed.limit = readValue(tokens, ++index, token);
    } else if (token === "--size") {
      parsed.size = readValue(tokens, ++index, token);
    } else if (token === "--bg") {
      parsed.bg = readValue(tokens, ++index, token);
    } else if (token === "--timeout-ms") {
      parsed.timeoutMs = readValue(tokens, ++index, token);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return parsed;
}

function readValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function printUsage() {
  console.log(`usage:
  node scripts/local-asset-visual-review.mjs --csv artifacts/local-assets/3dcg-assets.csv
  node scripts/local-asset-visual-review.mjs --limit 20 --size 640x480
  node scripts/local-asset-visual-review.mjs --kinds model,motion,splat

Renders local asset screenshots through scripts/run-shot.mjs shot-batch and writes
artifacts/local-assets/visual-review/visual-review.html for human review.
Default kinds: model,splat.`);
}

console.log(`Review page: ${pathToFileURL(htmlReportPath).href}`);
