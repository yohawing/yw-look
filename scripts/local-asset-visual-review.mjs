import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
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
const defaultLoadReport = path.join(
  repoRoot,
  "artifacts",
  "local-assets",
  "local-asset-load-report.json",
);

const argv = parseArgs(process.argv.slice(2));

if (argv.help) {
  printUsage();
  process.exit(0);
}

const csvPath = path.resolve(repoRoot, argv.csv ?? defaultCsv);
const outDir = path.resolve(repoRoot, argv.out ?? defaultOutDir);
const loadReportPath = path.resolve(
  repoRoot,
  argv.loadReport ?? defaultLoadReport,
);
const screenshotDir = path.join(outDir, "screenshots");
const selectedId = argv.case ?? null;
const limit = argv.limit === undefined ? null : Number(argv.limit);
const offset = argv.offset === undefined ? 0 : Number(argv.offset);
const size = argv.size ?? "640x480";
const background = argv.bg ?? "default";
const timeoutMs =
  argv.timeoutMs === undefined ? 600_000 : Number(argv.timeoutMs);
const serve = Boolean(argv.serve);
const serveOnly = Boolean(argv.serveOnly);
const htmlOnly = Boolean(argv.htmlOnly);
const servePort = argv.port === undefined ? 17831 : Number(argv.port);
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
if (!Number.isInteger(servePort) || servePort <= 0 || servePort > 65535) {
  throw new Error("--port must be a TCP port number");
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

if (serveOnly || htmlOnly) {
  const reportPath = path.join(outDir, "visual-review-report.json");
  const loadReport = await readJsonOptional(loadReportPath);
  const report = normalizeReportForHtml(
    JSON.parse(await readFile(reportPath, "utf8")),
    screenshotDir,
    loadReport,
  );
  const htmlReportPath = path.join(outDir, "visual-review.html");
  const markdownReportPath = path.join(outDir, "visual-review.md");
  await writeFile(markdownReportPath, renderMarkdown(report), "utf8");
  await writeFile(htmlReportPath, renderHtml(report), "utf8");
  console.log(`HTML     : ${htmlReportPath}`);
  console.log(`Markdown : ${markdownReportPath}`);
  if (serveOnly) {
    await serveReviewPage({
      outDir,
      htmlReportPath,
      report,
      preferredPort: servePort,
    });
  }
  process.exit(0);
}

console.log(
  `[visual-review] rendering ${shotCases.length} screenshot(s) at ${width}x${height}`,
);
let htmlReportPath = path.join(outDir, "visual-review.html");
const devServer = await ensureDevServer();
try {
  const run = await runShotBatch(configPath);
  const loadReport = await readJsonOptional(loadReportPath);

  const results = [];
  for (const [index, testCase] of cases.entries()) {
    const outputPath = shotCases[index].outputPath;
    const image = await inspectPng(outputPath);
    const result = attachDiagnostics(
      {
        ...publicCaseFields(testCase),
        screenshotPath: image.exists ? normalizeRepoPath(outputPath) : null,
        screenshotUrl: image.exists
          ? normalizePath(path.relative(outDir, outputPath))
          : null,
        sourceFolderPath: path.dirname(testCase.path),
        sourceFolderUrl: pathToFileURL(path.dirname(testCase.path)).href,
        screenshotFolderPath: screenshotDir,
        screenshotFolderUrl: pathToFileURL(screenshotDir).href,
        visualStatus: image.exists
          ? image.nonBlank
            ? "rendered"
            : "blank"
          : "missing",
        image,
      },
      loadReport,
    );
    results.push(result);
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

  if (serve) {
    await serveReviewPage({
      outDir,
      htmlReportPath,
      report,
      preferredPort: servePort,
    });
  }

  process.exitCode = run.exitCode !== 0 || report.summary.missing > 0 ? 1 : 0;
} finally {
  await stopDevServer(devServer);
}

async function serveReviewPage({
  outDir,
  htmlReportPath,
  report,
  preferredPort,
}) {
  const token = randomBytes(24).toString("hex");
  const allowedFolders = new Set(
    report.results.flatMap((result) =>
      [result.sourceFolderPath, result.screenshotFolderPath]
        .filter(Boolean)
        .map((entry) => path.resolve(entry).toLowerCase()),
    ),
  );
  const server = http.createServer((request, response) => {
    void handleReviewRequest({
      allowedFolders,
      htmlReportPath,
      outDir,
      request,
      response,
      token,
    });
  });
  const port = await listenOnAvailablePort(server, preferredPort);
  const url = `http://127.0.0.1:${port}/visual-review.html`;
  console.log(`[visual-review] serving review page at ${url}`);
  console.log("[visual-review] press Ctrl+C to stop the review server");
  await new Promise((resolve) => {
    const close = () => {
      server.close(() => resolve());
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

async function handleReviewRequest({
  allowedFolders,
  htmlReportPath,
  outDir,
  request,
  response,
  token,
}) {
  try {
    if (request.method === "POST" && request.url === "/__open-folder") {
      await handleOpenFolderRequest({
        allowedFolders,
        request,
        response,
        token,
      });
      return;
    }

    if (request.method !== "GET") {
      response.writeHead(405).end("method not allowed");
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname =
      requestUrl.pathname === "/" ? "/visual-review.html" : requestUrl.pathname;
    const targetPath = path.resolve(outDir, `.${decodeURIComponent(pathname)}`);
    if (!isPathInside(targetPath, outDir)) {
      response.writeHead(403).end("forbidden");
      return;
    }

    if (targetPath === path.resolve(htmlReportPath)) {
      const html = await readFile(htmlReportPath, "utf8");
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(html.replaceAll("__YW_LOOK_REVIEW_OPENER_TOKEN__", token));
      return;
    }

    const body = await readFile(targetPath);
    response.writeHead(200, { "content-type": contentTypeFor(targetPath) });
    response.end(body);
  } catch (error) {
    response
      .writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      .end(error instanceof Error ? error.message : String(error));
  }
}

async function handleOpenFolderRequest({
  allowedFolders,
  request,
  response,
  token,
}) {
  if (request.headers["x-yw-look-review-token"] !== token) {
    response.writeHead(403).end("forbidden");
    return;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 64 * 1024) {
      response.writeHead(413).end("request too large");
      return;
    }
  }

  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const folderPath = path.resolve(String(payload.path ?? ""));
  if (!allowedFolders.has(folderPath.toLowerCase())) {
    response.writeHead(403).end("folder is not in this review report");
    return;
  }

  await openFolder(folderPath);
  response
    .writeHead(200, { "content-type": "application/json; charset=utf-8" })
    .end(JSON.stringify({ ok: true }));
}

function openFolder(folderPath) {
  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  return new Promise((resolve, reject) => {
    const child = spawn(command, [folderPath], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function listenOnAvailablePort(server, preferredPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const onError = (error) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && port < preferredPort + 20) {
          tryPort(port + 1);
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    tryPort(preferredPort);
  });
}

function isPathInside(targetPath, rootPath) {
  const relative = path.relative(
    path.resolve(rootPath),
    path.resolve(targetPath),
  );
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeReportForHtml(report, screenshotDir, loadReport) {
  const results = report.results.map((result) => {
    const sourceFolderPath =
      result.sourceFolderPath ?? path.dirname(result.path);
    const screenshotFolderPath = result.screenshotFolderPath ?? screenshotDir;
    return attachDiagnostics(
      {
        ...result,
        sourceFolderPath,
        sourceFolderUrl:
          result.sourceFolderUrl ?? pathToFileURL(sourceFolderPath).href,
        screenshotFolderPath,
        screenshotFolderUrl:
          result.screenshotFolderUrl ??
          pathToFileURL(screenshotFolderPath).href,
      },
      loadReport,
    );
  });
  return {
    ...report,
    summary: summarize(results),
    results,
  };
}

function attachDiagnostics(result, loadReport) {
  const loadResult = loadReport?.results?.find(
    (entry) => entry.id === result.id,
  );
  const warnings = [...(loadResult?.warnings ?? [])];
  const logLines = collectDiagnosticLogLines(
    `${loadResult?.stderrTail ?? ""}\n${loadResult?.stdoutTail ?? ""}`,
  );
  const loadStatus = loadResult?.status ?? "unknown";
  const visualIssue =
    result.visualStatus === "missing" || result.visualStatus === "blank";
  const hasDiagnostics =
    visualIssue ||
    loadStatus === "warning" ||
    loadStatus === "fail" ||
    warnings.length > 0 ||
    Boolean(loadResult?.error) ||
    logLines.length > 0;
  const severity =
    loadStatus === "fail" || result.visualStatus === "missing"
      ? "error"
      : loadStatus === "warning" ||
          result.visualStatus === "blank" ||
          warnings.length > 0
        ? "warning"
        : logLines.length > 0
          ? "log"
          : "none";

  return {
    ...result,
    diagnostics: {
      severity,
      hasDiagnostics,
      hasIssue: severity === "error" || severity === "warning",
      visualStatus: result.visualStatus,
      loadStatus,
      loadCategory: loadResult?.category ?? null,
      loadDurationMs: loadResult?.durationMs ?? null,
      loadExitCode: loadResult?.exitCode ?? null,
      loadError: loadResult?.error ?? null,
      warnings,
      logLines,
      stderrTail: loadResult?.stderrTail ?? "",
      stdoutTail: loadResult?.stdoutTail ?? "",
    },
  };
}

function collectDiagnosticLogLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /\b(error|warn|warning|failed|timeout)\b/i.test(line))
    .filter((line) => !isKnownBenignDiagnosticLine(line))
    .slice(0, 20);
}

function isKnownBenignDiagnosticLine(line) {
  return /Failed to unregister class Chrome_WidgetWin_0\. Error = 1412/i.test(
    line,
  );
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
    "| Visual | Load | Diag | Kind | Ext | Screenshot | Source |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${result.visualStatus} | ${result.diagnostics?.loadStatus ?? "unknown"} | ${result.diagnostics?.severity ?? "none"} | ${result.kind} | ${result.extension} | ${result.screenshotPath ?? ""} | ${result.path} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderHtml(report) {
  const summary = summarize(report.results);
  const extensionOptions = Object.keys(summary.byExtension)
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    )
    .map(
      (extension) =>
        `<option value="${escapeHtml(extension)}">${escapeHtml(extension)}</option>`,
    )
    .join("");
  const resultJson = JSON.stringify(
    report.results.map((result) => ({
      id: result.id,
      path: result.path,
      extension: result.extension,
      kind: result.kind,
      visualStatus: result.visualStatus,
      diagnosticSeverity: result.diagnostics?.severity ?? "none",
      loadStatus: result.diagnostics?.loadStatus ?? "unknown",
      warningCount: result.diagnostics?.warnings?.length ?? 0,
      logCount: result.diagnostics?.logLines?.length ?? 0,
      sourceFolderPath: result.sourceFolderPath,
      screenshotFolderPath: result.screenshotFolderPath,
    })),
  ).replaceAll("</", "<\\/");
  const rows = report.results
    .map((result, index) => renderCard(result, index))
    .join("\n");
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
      font-feature-settings: "cv01", "ss03";
      background: #08090a;
      color: #f7f8f8;
    }
    body {
      margin: 0;
      background: #08090a;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(8,9,10,.94);
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
      font-weight: 590;
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
    select {
      color-scheme: dark;
      background-color: #14181f;
    }
    option {
      background-color: #191a1b;
      color: #f7f8f8;
    }
    button {
      cursor: pointer;
    }
    select, button, a.link-button {
      min-height: 30px;
    }
    a.link-button {
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 6px;
      background: rgba(255,255,255,.04);
      color: #eef2f7;
      padding: 6px 8px;
      text-decoration: none;
      white-space: nowrap;
    }
    .actions, .card-tools {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .card-tools {
      flex-direction: column;
      margin-top: 2px;
    }
    .tool-row {
      display: grid;
      grid-template-columns: 50px 1fr;
      gap: 8px;
      align-items: center;
    }
    .tool-label {
      color: #62666d;
      font-size: 11px;
      font-weight: 510;
    }
    .actions {
      margin-top: 8px;
    }
    .actions button, .actions a {
      font-size: 11px;
    }
    main {
      max-width: 1440px;
      margin: 0 auto;
      padding: 20px 24px 40px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    article {
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(255,255,255,.025);
      box-shadow: rgba(0,0,0,.2) 0 0 0 1px;
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
    article[data-diagnostic="error"] {
      border-color: rgba(255,96,96,.72);
    }
    article[data-diagnostic="warning"] {
      border-color: rgba(255,198,87,.72);
    }
    article[data-diagnostic="log"] {
      border-color: rgba(113,112,255,.45);
    }
    .shot {
      display: block;
      width: 100%;
      aspect-ratio: ${width} / ${height};
      object-fit: contain;
      background: #111318;
      user-select: none;
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
      display: grid;
      gap: 10px;
      padding: 12px;
    }
    .title {
      margin: 0;
      font-size: 13px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .card-head {
      display: grid;
      gap: 8px;
    }
    .meta-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .path {
      margin: 0;
      color: #8d99a8;
      font-size: 11px;
      line-height: 1.4;
      overflow-wrap: anywhere;
      max-height: 46px;
      overflow: auto;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
    }
    .review-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .review-control {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #d0d6e0;
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
    .badge.pass, .badge.none {
      color: #d7f8df;
    }
    .badge.warning {
      color: #ffe0a3;
    }
    .badge.fail, .badge.error {
      color: #ffd4d4;
    }
    .badge.log {
      color: #c9ccff;
    }
    details.diagnostics {
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 6px;
      background: rgba(0,0,0,.16);
      color: #aab4c0;
      font-size: 11px;
    }
    details.diagnostics summary {
      cursor: pointer;
      padding: 7px 8px;
      color: #d0d6e0;
      font-weight: 510;
    }
    .diagnostic-body {
      display: grid;
      gap: 8px;
      padding: 0 8px 8px;
    }
    .diagnostic-block {
      display: grid;
      gap: 4px;
    }
    .diagnostic-label {
      color: #62666d;
      font-size: 10px;
      font-weight: 510;
      text-transform: uppercase;
    }
    pre.diagnostic-log {
      margin: 0;
      max-height: 112px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      border-radius: 6px;
      background: rgba(0,0,0,.2);
      color: #cbd5e1;
      padding: 8px;
      font-family: ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace;
      font-size: 10px;
      line-height: 1.45;
    }
    textarea {
      width: 100%;
      min-height: 52px;
      box-sizing: border-box;
      resize: vertical;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 6px;
      background: rgba(0,0,0,.2);
      color: #eef2f7;
      padding: 8px;
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
        <span class="pill">Issues ${summary.diagnostics.issue}</span>
        <span class="pill">Warnings ${summary.diagnostics.warning}</span>
        <span class="pill">Errors ${summary.diagnostics.error}</span>
        <span class="pill">Logs ${summary.diagnostics.log}</span>
        <span class="pill">${escapeHtml(report.filters.size)}</span>
      </div>
      <div class="controls" style="margin-top:10px">
        <label>Visual <select id="visualFilter"><option value="">All</option><option>rendered</option><option>blank</option><option>missing</option></select></label>
        <label>Ext <select id="extensionFilter"><option value="">All</option>${extensionOptions}</select></label>
        <label>Diagnostics <select id="diagnosticFilter"><option value="">All</option><option value="issue">Issues</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="log">Logs</option><option value="none">None</option></select></label>
        <label>Review <select id="reviewFilter"><option value="">All</option><option value="unreviewed">Unreviewed</option><option value="ok">OK</option><option value="suspect">Suspect</option><option value="bad">Bad</option></select></label>
        <label>Sort <select id="sortSelect"><option value="extension" selected>Extension</option><option value="original">Original</option><option value="id">Name</option><option value="kind">Kind</option><option value="diagnostic">Diagnostics</option></select></label>
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
    const reviewOpenerToken = "__YW_LOOK_REVIEW_OPENER_TOKEN__";
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
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
      const extension = document.getElementById("extensionFilter").value;
      const diagnostic = document.getElementById("diagnosticFilter").value;
      const review = document.getElementById("reviewFilter").value;
      for (const card of document.querySelectorAll("article")) {
        const visualMatch = !visual || card.dataset.visual === visual;
        const extensionMatch = !extension || card.dataset.extension === extension;
        const diagnosticMatch = !diagnostic || card.dataset.diagnostic === diagnostic || (diagnostic === "issue" && card.dataset.hasIssue === "true");
        const reviewMatch = !review || card.dataset.review === review;
        card.classList.toggle("hidden", !(visualMatch && extensionMatch && diagnosticMatch && reviewMatch));
      }
    }
    function applySort() {
      const sort = document.getElementById("sortSelect").value;
      const grid = document.getElementById("grid");
      const cards = Array.from(grid.querySelectorAll("article"));
      cards.sort((left, right) => compareCards(left, right, sort));
      grid.append(...cards);
    }
    function compareCards(left, right, sort) {
      if (sort === "original") {
        return Number(left.dataset.index) - Number(right.dataset.index);
      }
      if (sort === "diagnostic") {
        const severityOrder = { error: 0, warning: 1, log: 2, none: 3 };
        return (
          (severityOrder[left.dataset.diagnostic] ?? 9) -
            (severityOrder[right.dataset.diagnostic] ?? 9) ||
          compareText(left.dataset.extension, right.dataset.extension) ||
          compareText(left.dataset.id, right.dataset.id)
        );
      }
      if (sort === "kind") {
        return (
          compareText(left.dataset.kind, right.dataset.kind) ||
          compareText(left.dataset.extension, right.dataset.extension) ||
          compareText(left.dataset.id, right.dataset.id)
        );
      }
      if (sort === "id") {
        return compareText(left.dataset.id, right.dataset.id);
      }
      return (
        compareText(left.dataset.extension, right.dataset.extension) ||
        compareText(left.dataset.kind, right.dataset.kind) ||
        compareText(left.dataset.id, right.dataset.id)
      );
    }
    function compareText(left, right) {
      return collator.compare(left || "", right || "");
    }
    function orderedReportResults() {
      const byId = new Map(reportResults.map((result) => [result.id, result]));
      return Array.from(document.querySelectorAll("article"))
        .map((card) => byId.get(card.dataset.id))
        .filter(Boolean);
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
      for (const button of card.querySelectorAll("[data-copy]")) {
        button.addEventListener("click", async () => {
          await copyText(button.dataset.copy || "");
          showButtonState(button, "Copied");
        });
      }
      for (const link of card.querySelectorAll("[data-open-folder]")) {
        link.addEventListener("click", async (event) => {
          if (!canUseFolderOpener()) return;
          event.preventDefault();
          try {
            await openFolder(link.dataset.openFolder || "");
            showButtonState(link, "Opened");
          } catch {
            await copyText(link.dataset.openFolder || "");
            showButtonState(link, "Copied path");
          }
        });
      }
    }
    function canUseFolderOpener() {
      return location.protocol === "http:" && reviewOpenerToken !== "__YW_LOOK_REVIEW_OPENER_TOKEN__";
    }
    async function openFolder(folderPath) {
      const response = await fetch("/__open-folder", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-yw-look-review-token": reviewOpenerToken
        },
        body: JSON.stringify({ path: folderPath })
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    }
    function showButtonState(element, text) {
      const original = element.textContent;
      element.textContent = text;
      setTimeout(() => {
        element.textContent = original;
      }, 900);
    }
    async function copyText(value) {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          return;
        } catch {}
      }
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    document.getElementById("visualFilter").addEventListener("change", applyFilters);
    document.getElementById("extensionFilter").addEventListener("change", applyFilters);
    document.getElementById("diagnosticFilter").addEventListener("change", applyFilters);
    document.getElementById("reviewFilter").addEventListener("change", applyFilters);
    document.getElementById("sortSelect").addEventListener("change", () => {
      applySort();
      applyFilters();
    });
    document.getElementById("exportButton").addEventListener("click", () => {
      const payload = orderedReportResults().map((result) => ({
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
    applySort();
    applyFilters();
  </script>
</body>
</html>
`;
}

function renderCard(result, index) {
  const image = result.screenshotUrl
    ? `<img class="shot" src="${escapeHtml(result.screenshotUrl)}" loading="lazy" alt="${escapeHtml(result.id)}" draggable="false">`
    : `<div class="missing-shot">No screenshot</div>`;
  const diagnostics = result.diagnostics ?? { severity: "none" };
  const warningCount = diagnostics.warnings?.length ?? 0;
  const logCount = diagnostics.logLines?.length ?? 0;
  const diagnosticDetails = renderDiagnostics(result);
  return `<article data-index="${index}" data-id="${escapeHtml(result.id)}" data-kind="${escapeHtml(result.kind)}" data-extension="${escapeHtml(result.extension)}" data-visual="${escapeHtml(result.visualStatus)}" data-diagnostic="${escapeHtml(diagnostics.severity ?? "none")}" data-has-diagnostics="${diagnostics.hasDiagnostics ? "true" : "false"}" data-has-issue="${diagnostics.hasIssue ? "true" : "false"}" data-review="unreviewed">
  ${image}
  <div class="body">
    <div class="card-head">
      <h2 class="title">${escapeHtml(result.id)}</h2>
      <div class="meta-badges">
        <span class="badge ${escapeHtml(result.visualStatus)}">${escapeHtml(result.visualStatus)}</span>
        <span class="badge ${escapeHtml(diagnostics.loadStatus ?? "unknown")}">load ${escapeHtml(diagnostics.loadStatus ?? "unknown")}</span>
        <span class="badge">${escapeHtml(result.kind)} / ${escapeHtml(result.extension)}</span>
        <span class="badge">${Math.round(result.image.changedPixelRatio * 10000) / 100}% changed</span>
        ${warningCount > 0 ? `<span class="badge warning">${warningCount} warning</span>` : ""}
        ${logCount > 0 ? `<span class="badge log">${logCount} log</span>` : ""}
      </div>
    </div>
    <p class="path">${escapeHtml(result.path)}</p>
    ${diagnosticDetails}
    <div class="card-tools">
      <div class="tool-row">
        <span class="tool-label">Folders</span>
        <div class="actions">
          <a class="link-button" href="${escapeHtml(result.sourceFolderUrl)}" target="_blank" rel="noreferrer" data-open-folder="${escapeHtml(result.sourceFolderPath)}">Source</a>
          <a class="link-button" href="${escapeHtml(result.screenshotFolderUrl)}" target="_blank" rel="noreferrer" data-open-folder="${escapeHtml(result.screenshotFolderPath)}">Shot</a>
        </div>
      </div>
      <div class="tool-row">
        <span class="tool-label">Copy</span>
        <div class="actions">
          <button type="button" data-copy="${escapeHtml(result.path)}">File path</button>
          <button type="button" data-copy="${escapeHtml(result.sourceFolderPath)}">Folder path</button>
        </div>
      </div>
    </div>
    <div class="review-row">
      <label class="review-control">Review <select data-role="review"><option value="unreviewed">Unreviewed</option><option value="ok">OK</option><option value="suspect">Suspect</option><option value="bad">Bad</option></select></label>
    </div>
    <textarea data-role="note" placeholder="note"></textarea>
  </div>
</article>`;
}

function renderDiagnostics(result) {
  const diagnostics = result.diagnostics;
  if (!diagnostics?.hasDiagnostics) {
    return "";
  }

  const blocks = [];
  if (result.visualStatus !== "rendered") {
    blocks.push(
      renderDiagnosticBlock(
        "Visual",
        `Screenshot status: ${result.visualStatus}${
          result.image?.error ? `\n${result.image.error}` : ""
        }`,
      ),
    );
  }
  if (diagnostics.loadStatus && diagnostics.loadStatus !== "pass") {
    blocks.push(
      renderDiagnosticBlock(
        "Load",
        [
          `status: ${diagnostics.loadStatus}`,
          diagnostics.loadCategory
            ? `category: ${diagnostics.loadCategory}`
            : "",
          diagnostics.loadExitCode !== null &&
          diagnostics.loadExitCode !== undefined
            ? `exitCode: ${diagnostics.loadExitCode}`
            : "",
          diagnostics.loadError ? `error: ${diagnostics.loadError}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }
  if (diagnostics.warnings?.length > 0) {
    blocks.push(
      renderDiagnosticBlock("Warnings", diagnostics.warnings.join("\n")),
    );
  }
  if (diagnostics.logLines?.length > 0) {
    blocks.push(renderDiagnosticBlock("Log", diagnostics.logLines.join("\n")));
  }

  const summaryParts = [
    diagnostics.severity,
    diagnostics.loadStatus ? `load ${diagnostics.loadStatus}` : "",
    diagnostics.warnings?.length
      ? `${diagnostics.warnings.length} warning`
      : "",
    diagnostics.logLines?.length ? `${diagnostics.logLines.length} log` : "",
  ].filter(Boolean);

  return `<details class="diagnostics">
    <summary>Diagnostics: ${escapeHtml(summaryParts.join(" / "))}</summary>
    <div class="diagnostic-body">
      ${blocks.join("\n")}
    </div>
  </details>`;
}

function renderDiagnosticBlock(label, body) {
  return `<div class="diagnostic-block">
    <span class="diagnostic-label">${escapeHtml(label)}</span>
    <pre class="diagnostic-log">${escapeHtml(body)}</pre>
  </div>`;
}

function summarize(results) {
  const summary = {
    total: results.length,
    rendered: 0,
    blank: 0,
    missing: 0,
    diagnostics: {
      issue: 0,
      error: 0,
      warning: 0,
      log: 0,
      none: 0,
      loadPass: 0,
      loadWarning: 0,
      loadFail: 0,
      loadUnknown: 0,
    },
    byKind: {},
    byExtension: {},
  };
  for (const result of results) {
    summary[result.visualStatus] += 1;
    const diagnostics = result.diagnostics ?? {};
    const severity = diagnostics.severity ?? "none";
    summary.diagnostics[severity] += 1;
    if (diagnostics.hasIssue) {
      summary.diagnostics.issue += 1;
    }
    switch (diagnostics.loadStatus) {
      case "pass":
        summary.diagnostics.loadPass += 1;
        break;
      case "warning":
        summary.diagnostics.loadWarning += 1;
        break;
      case "fail":
        summary.diagnostics.loadFail += 1;
        break;
      default:
        summary.diagnostics.loadUnknown += 1;
        break;
    }
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
    } else if (token === "--load-report") {
      parsed.loadReport = readValue(tokens, ++index, token);
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
    } else if (token === "--serve") {
      parsed.serve = true;
    } else if (token === "--serve-only") {
      parsed.serveOnly = true;
    } else if (token === "--html-only") {
      parsed.htmlOnly = true;
    } else if (token === "--port") {
      parsed.port = readValue(tokens, ++index, token);
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
  node scripts/local-asset-visual-review.mjs --load-report artifacts/local-assets/local-asset-load-report.json
  node scripts/local-asset-visual-review.mjs --html-only
  node scripts/local-asset-visual-review.mjs --serve-only

Renders local asset screenshots through scripts/run-shot.mjs shot-batch and writes
artifacts/local-assets/visual-review/visual-review.html for human review.
Default kinds: model,splat.

--serve starts a localhost review page after rendering. --serve-only serves an
existing report without rerendering screenshots. Folder buttons open Explorer
only on the localhost review page; file:// pages keep folder links and copy
buttons. The visual review page merges load-check diagnostics from
artifacts/local-assets/local-asset-load-report.json by default.`);
}

console.log(`Review page: ${pathToFileURL(htmlReportPath).href}`);
