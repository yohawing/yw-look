import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  ThreeMmdLoader,
  parsePmdMetadata,
  parsePmxMetadata,
  parseVmdMetadata,
  parseVpdMetadata,
} from "@yohawing/three-mmd-loader";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultRoot = "F:\\Develop\\MMDDev\\data";
const defaultOut = path.join(repoRoot, "artifacts", "logs");
const loaderAssetRoot = path.join(
  repoRoot,
  "node_modules",
  "@yohawing",
  "three-mmd-loader",
  "dist",
  "three",
  "assets",
  "mmd",
);
const modelExtensions = new Set([".pmd", ".pmx"]);
const motionExtensions = new Set([".vmd", ".vpd"]);

const argv = parseArgs(process.argv.slice(2));
const scanRoot = path.resolve(argv.root ?? defaultRoot);
const outDir = path.resolve(argv.out ?? defaultOut);
const limit = argv.limit === undefined ? undefined : Number(argv.limit);

if (argv.help) {
  console.log(
    `usage: node scripts/mmd-load-scan.mjs [--root <dir>] [--out <dir>] [--limit <n>]`,
  );
  process.exit(0);
}

await fs.mkdir(outDir, { recursive: true });

const files = (await collectMmdFiles(scanRoot)).slice(0, limit);
const startedAt = new Date();
const results = [];

for (const [index, file] of files.entries()) {
  const relativePath = normalizePath(path.relative(scanRoot, file));
  const extension = path.extname(file).toLowerCase();
  process.stdout.write(`[${index + 1}/${files.length}] ${relativePath}\n`);
  results.push(await scanFile(file, relativePath, extension));
}

const finishedAt = new Date();
const summary = summarize(results);
const report = {
  schemaVersion: 1,
  root: scanRoot,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  summary,
  results,
};

const jsonPath = path.join(outDir, "mmddev-loader-report.json");
const markdownPath = path.join(outDir, "mmddev-loader-report.md");
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
process.exit(summary.fail > 0 ? 1 : 0);

async function scanFile(file, relativePath, extension) {
  const result = {
    path: relativePath,
    extension: extension.slice(1),
    status: "pass",
    name: "",
    formatVersion: "",
    warningCount: 0,
    warnings: [],
    error: "",
    durationMs: 0,
  };
  const started = performance.now();
  try {
    const bytes = await fs.readFile(file);
    if (modelExtensions.has(extension)) {
      const metadata =
        extension === ".pmx"
          ? parsePmxMetadata(bytes)
          : parsePmdMetadata(bytes);
      result.name = cleanString(metadata.englishName || metadata.name || "");
      result.formatVersion = `${metadata.format.toUpperCase()} ${metadata.header.version}`;
      const loader = new ThreeMmdLoader({
        textureResolver: createLocalTextureResolver(file),
        textureLoader: createStubTextureLoader(),
      });
      const model = await loader.loadModel(bytes, { outlines: false });
      const diagnostics = model.textureDiagnostics ?? [];
      result.warningCount = diagnostics.length;
      result.warnings = diagnostics.map((diagnostic) => ({
        code: cleanString(diagnostic.code),
        level: cleanString(diagnostic.level),
        textureKind: cleanString(diagnostic.textureKind),
        path: cleanString(diagnostic.path),
        materialIndex: diagnostic.materialIndex,
      }));
      if (diagnostics.length > 0) {
        result.status = "warning";
      }
      disposeObject(model.mesh);
      for (const outline of model.outlineMeshes ?? []) {
        disposeObject(outline);
      }
      for (const renderOrderMesh of model.renderOrderMeshes ?? []) {
        disposeObject(renderOrderMesh);
      }
    } else if (extension === ".vmd") {
      const metadata = parseVmdMetadata(bytes);
      result.name = cleanString(metadata.modelName ?? "");
      result.formatVersion = "VMD";
    } else if (extension === ".vpd") {
      const metadata = parseVpdMetadata(bytes);
      result.name = cleanString(metadata.modelName ?? "");
      result.formatVersion = "VPD";
    } else {
      result.status = "fail";
      result.error = `Unsupported extension: ${extension}`;
    }
  } catch (error) {
    result.status = "fail";
    result.error = cleanString(
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    result.durationMs = Math.round(performance.now() - started);
  }
  return result;
}

function createLocalTextureResolver(modelPath) {
  const modelDirectory = path.dirname(modelPath);
  return {
    async resolve(texturePath) {
      if (!texturePath || isRemoteOrInlineUrl(texturePath)) {
        return texturePath;
      }
      const candidates = texturePath
        .split("*")
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const candidate of candidates) {
        const resolved = path.resolve(
          modelDirectory,
          candidate.replaceAll("/", path.sep),
        );
        try {
          const bytes = await fs.readFile(resolved);
          return new Blob([bytes]);
        } catch {
          // Try the next texture candidate from an MMD compound texture path.
        }
      }
      const builtInToonTexturePath = resolveBuiltInToonTexturePath(texturePath);
      if (builtInToonTexturePath) {
        const bytes = await fs.readFile(builtInToonTexturePath);
        return new Blob([bytes]);
      }
      return undefined;
    },
  };
}

function resolveBuiltInToonTexturePath(texturePath) {
  const normalized = texturePath
    .split("?")[0]
    .split("#")[0]
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();
  if (
    normalized.includes("/") ||
    !/^toon(?:0[1-9]|10)\.bmp$/.test(normalized)
  ) {
    return undefined;
  }
  return path.join(loaderAssetRoot, normalized);
}

function createStubTextureLoader() {
  return {
    load(_url, onLoad) {
      const texture = new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
        THREE.RGBAFormat,
      );
      texture.needsUpdate = true;
      queueMicrotask(() => onLoad(texture));
      return texture;
    },
  };
}

function disposeObject(object) {
  object.traverse((node) => {
    const material = node.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry?.dispose?.();
      }
    } else {
      material?.dispose?.();
    }
    node.geometry?.dispose?.();
  });
}

async function collectMmdFiles(root) {
  const output = [];
  await walk(root, output);
  return output.sort((a, b) =>
    normalizePath(a).localeCompare(normalizePath(b), "ja", { numeric: true }),
  );
}

async function walk(directory, output) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, output);
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (modelExtensions.has(extension) || motionExtensions.has(extension)) {
      output.push(fullPath);
    }
  }
}

function summarize(results) {
  const summary = {
    total: results.length,
    pass: 0,
    warning: 0,
    fail: 0,
    byExtension: {},
  };
  for (const result of results) {
    summary[result.status] += 1;
    summary.byExtension[result.extension] ??= {
      total: 0,
      pass: 0,
      warning: 0,
      fail: 0,
    };
    summary.byExtension[result.extension].total += 1;
    summary.byExtension[result.extension][result.status] += 1;
  }
  return summary;
}

function renderMarkdown(report) {
  const lines = [
    "# MMDDev Loader Scan",
    "",
    `- Root: \`${report.root}\``,
    `- Started: ${report.startedAt}`,
    `- Duration: ${Math.round(report.durationMs / 1000)}s`,
    `- Total: ${report.summary.total}`,
    `- Pass: ${report.summary.pass}`,
    `- Warning: ${report.summary.warning}`,
    `- Fail: ${report.summary.fail}`,
    "",
    "## By Extension",
    "",
    "| Extension | Total | Pass | Warning | Fail |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const [extension, item] of Object.entries(report.summary.byExtension)) {
    lines.push(
      `| ${extension} | ${item.total} | ${item.pass} | ${item.warning} | ${item.fail} |`,
    );
  }
  lines.push("", "## Failures", "");
  const failures = report.results.filter((result) => result.status === "fail");
  if (failures.length === 0) {
    lines.push("No failures.");
  } else {
    for (const result of failures) {
      lines.push(`- \`${result.path}\`: ${result.error}`);
    }
  }
  lines.push("", "## Warnings", "");
  const warnings = report.results.filter(
    (result) => result.status === "warning",
  );
  if (warnings.length === 0) {
    lines.push("No warnings.");
  } else {
    for (const result of warnings.slice(0, 200)) {
      const warningSummary = summarizeWarnings(result.warnings);
      lines.push(
        `- \`${result.path}\`: ${result.warningCount} warning(s) - ${warningSummary}`,
      );
    }
    if (warnings.length > 200) {
      lines.push(
        `- ... ${warnings.length - 200} more warning entries omitted from Markdown.`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function summarizeWarnings(warnings) {
  const counts = new Map();
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.textureKind}:${warning.path}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .slice(0, 5)
    .map(([key, count]) => `${key} x${count}`)
    .join(", ");
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
    } else if (token === "--root") {
      parsed.root = tokens[++index];
    } else if (token === "--out") {
      parsed.out = tokens[++index];
    } else if (token === "--limit") {
      parsed.limit = tokens[++index];
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return parsed;
}

function isRemoteOrInlineUrl(value) {
  return /^(?:https?:|data:|blob:|asset:)/i.test(value);
}

function normalizePath(value) {
  return cleanString(value.replaceAll("\\", "/"));
}

function cleanString(value) {
  return String(value)
    .normalize("NFC")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
        ? " "
        : character;
    })
    .join("")
    .replace(/\r?\n/g, " ")
    .trim();
}
