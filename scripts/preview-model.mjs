import { spawn } from "node:child_process";
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
  // USD family: handled by converting to GLB via the `usd_to_glb`
  // Rust bin before feeding the existing glTF preview path. This
  // exercises the same `OpenusdBackend::extract_geometry_glb`
  // pipeline that the Tauri command uses in production, so Phase
  // 6/7 features (normal maps, UsdTransform2d, morph targets,
  // KHR_lights_punctual, cameras) are validated end-to-end.
  "usd",
  "usda",
  "usdc",
  "usdz",
]);

const USD_EXTS = new Set(["usd", "usda", "usdc", "usdz"]);

const args = process.argv.slice(2);
const modelArg = args.find((a, i) => {
  if (a.startsWith("--")) return false;
  // Skip values that follow known option flags (--out <dir>, --url <u>).
  const prev = i > 0 ? args[i - 1] : "";
  return prev !== "--out" && prev !== "--url";
});

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
const noAnim = args.includes("--no-anim");

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

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseName = path.basename(absModel, path.extname(absModel));

// USD inputs are converted to GLB via the `usd_to_glb` cargo bin
// before we hand them to the Vite-hosted selftest. The converted
// file lands alongside the screenshot / log so it's inspectable
// (drag it into gltf-viewer etc.) when something looks off.
let previewPath = absModel;
let convertedGlb = null;
let convertLog = null;
if (USD_EXTS.has(ext)) {
  await mkdir(outDir, { recursive: true });
  convertedGlb = path.resolve(
    path.join(outDir, `${baseName}-${timestamp}.glb`),
  );
  const result = await runUsdToGlb(absModel, convertedGlb);
  convertLog = result;
  if (!result.ok) {
    const logFile = path.join(outDir, `${baseName}-${timestamp}.convert.log`);
    await writeFile(
      logFile,
      `cmd: ${result.cmd}\nexitCode: ${result.exitCode}\n\n[stdout]\n${result.stdout}\n\n[stderr]\n${result.stderr}\n`,
    );
    console.error(
      JSON.stringify(
        {
          ok: false,
          model: absModel,
          stage: "usd_to_glb",
          exitCode: result.exitCode,
          stderr: result.stderr.slice(0, 2000),
          log: logFile,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  previewPath = convertedGlb;
}

const fsUrlPath = "/@fs/" + previewPath.replace(/\\/g, "/");
const qsExtra = noAnim ? "&noanim=1" : "";
const targetUrl = `${devUrl.replace(/\/$/, "")}/selftest.html?path=${encodeURIComponent(fsUrlPath)}${qsExtra}`;

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

if (convertedGlb) {
  verdict.convertedGlb = convertedGlb;
  verdict.convertStage = {
    durationMs: convertLog?.durationMs ?? null,
    cmd: convertLog?.cmd ?? null,
  };
}

console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.ok ? 0 : 1);

async function runUsdToGlb(inputAbs, outputAbs) {
  const cargoManifest = path.resolve("src-tauri/Cargo.toml");
  // Backend is chosen at build time via Cargo features:
  //   YW_LOOK_USD_BACKEND=cpp  → vcpkg OpenUSD via usd_c_shim
  //                               (requires VCPKG_ROOT + LLVM locally)
  //   anything else / unset    → yohawing/openusd Rust fork (default)
  // `usd_to_glb` uses `DefaultBackend`, which resolves per feature in
  // src/usd/mod.rs — flipping this env var is enough to drive the two
  // backends through the same preview-model skill.
  const backend = (process.env.YW_LOOK_USD_BACKEND || "").toLowerCase();
  const features = [];
  const noDefault = backend === "cpp";
  if (backend === "cpp") {
    features.push("backend-openusd-cpp");
  }
  const args = [
    "run",
    "--quiet",
    "--release",
    "--manifest-path",
    cargoManifest,
    ...(noDefault ? ["--no-default-features"] : []),
    ...(features.length > 0 ? ["--features", features.join(",")] : []),
    "--bin",
    "usd_to_glb",
    "--",
    inputAbs,
    outputAbs,
  ];
  const started = Date.now();
  const child = spawn("cargo", args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
  const durationMs = Date.now() - started;
  return {
    ok: exitCode === 0,
    cmd: ["cargo", ...args].join(" "),
    exitCode,
    stdout,
    stderr,
    durationMs,
  };
}
