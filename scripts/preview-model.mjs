import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SUPPORTED = new Set([
  "glb",
  "gltf",
  "fbx",
  "obj",
  "ply",
  "stl",
  "png",
  "jpg",
  "jpeg",
  "tga",
  "dds",
  "hdr",
  "exr",
]);

const args = process.argv.slice(2);
const modelArg = args[0];

if (!modelArg || modelArg === "--help" || modelArg === "-h") {
  console.error(
    "usage: node scripts/preview-model.mjs <model-path> [--out <dir>] [--url <dev-server-url>]",
  );
  process.exit(2);
}

const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : "artifacts/preview";
const urlIdx = args.indexOf("--url");
const devUrl = urlIdx >= 0 ? args[urlIdx + 1] : "http://localhost:1420";

const absModel = path.resolve(modelArg);
try {
  await stat(absModel);
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        model: absModel,
        error: `file not found: ${error instanceof Error ? error.message : String(error)}`,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const ext = path.extname(absModel).replace(/^\./, "").toLowerCase();
if (!SUPPORTED.has(ext)) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        model: absModel,
        error: `unsupported format: .${ext}. supported: ${[...SUPPORTED].join(", ")}`,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const fsUrlPath = "/@fs/" + absModel.replace(/\\/g, "/");
const targetUrl = `${devUrl.replace(/\/$/, "")}/selftest.html?path=${encodeURIComponent(fsUrlPath)}`;

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseName = path.basename(absModel, path.extname(absModel));
const shotPath = path.join(outDir, `${baseName}-${timestamp}.png`);
const logPath = path.join(outDir, `${baseName}-${timestamp}.log.jsonl`);

const consoleLog = [];
let browser;
let outputJson = null;
let shotBuffer = null;
let waitError = null;

try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  page.on("console", (msg) => {
    consoleLog.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (err) => {
    consoleLog.push({ type: "pageerror", text: err.message });
  });

  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });

  try {
    await page.waitForFunction(
      () => {
        const text =
          globalThis.document?.getElementById("output")?.textContent ?? "";
        return text.includes('"mode": "single"') || text.includes('"fatal"');
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    waitError = error instanceof Error ? error.message : String(error);
  }

  const rawOutput = await page.textContent("#output");
  try {
    outputJson = rawOutput ? JSON.parse(rawOutput) : null;
  } catch {
    outputJson = { parseError: true, raw: rawOutput };
  }

  const canvas = await page.$("#preview-canvas");
  shotBuffer = canvas
    ? await canvas.screenshot()
    : await page.screenshot({ fullPage: true });
} finally {
  await browser?.close();
}

await mkdir(outDir, { recursive: true });
await writeFile(shotPath, shotBuffer);
await writeFile(
  logPath,
  consoleLog.map((entry) => JSON.stringify(entry)).join("\n"),
);

const errorLogs = consoleLog.filter((entry) => {
  if (entry.type === "error" || entry.type === "pageerror") {
    return !/Context Lost|CONTEXT_LOST_WEBGL/i.test(entry.text);
  }
  return /\[viewer\] load failed|USDLoader\.parse failed/i.test(entry.text);
});

const verdict = {
  ok: Boolean(outputJson?.ok) && errorLogs.length === 0 && !waitError,
  model: absModel,
  url: targetUrl,
  screenshot: path.resolve(shotPath),
  log: path.resolve(logPath),
  output: outputJson,
  waitError,
  errorLogCount: errorLogs.length,
  errorLogs: errorLogs.slice(0, 10),
};

console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.ok ? 0 : 1);
