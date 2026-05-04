// Fetches private benchmark samples into samples/private/.
//
// Manual fallback URLs for restricted networks:
// - Khronos glTF assets: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models
// - Sponza tree: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Sponza/glTF
// - Flight Helmet tree: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/FlightHelmet/glTF
// - Pixar Kitchen Set: https://openusd.org/release/dl/kitchen_set.zip
// - Pixar Kitchen Set mirror candidate: https://graphics.pixar.com/usd/release/dl/Kitchen_set.zip
// - Apple Toy Biplane: https://developer.apple.com/augmented-reality/quick-look/models/biplane/toy_biplane.usdz

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const manifestPath = path.join(repoRoot, "samples", "private", "models.json");
const tmpRoot = path.join(repoRoot, "samples", "private", ".tmp");

function resolveRepoPath(value) {
  const resolved = path.resolve(repoRoot, value);
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
    throw new Error(`refusing path outside repo: ${value}`);
  }
  return resolved;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const data = await readFile(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "unknown bytes";
  return `${value.toLocaleString("en-US")} bytes`;
}

function expectedValue(value) {
  return value === "" || value === null || value === undefined ? null : value;
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause instanceof Error
      ? ` cause=${error.cause.message}`
    : error.cause
        ? ` cause=${JSON.stringify(error.cause)}`
        : "";
  return `${error.message}${cause}`;
}

async function download(url, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const response = await fetch(url, {
    headers: { "User-Agent": "yw-look-sample-fetch" },
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `download failed ${response.status} ${response.statusText}: ${url}`,
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength)) {
    console.log(`[samples] content-length ${formatBytes(contentLength)}: ${url}`);
  } else {
    console.log(`[samples] content-length unknown: ${url}`);
  }

  await pipeline(response.body, createWriteStream(outputPath));
  const size = (await stat(outputPath)).size;
  return {
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    size,
  };
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
      }
    });
  });
}

async function findByBasename(root, basename) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findByBasename(fullPath, basename);
      if (found) {
        return found;
      }
    } else if (entry.name.toLowerCase() === basename.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

async function githubContents(repo, treePath) {
  const encodedPath = treePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=main`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "yw-look-sample-fetch",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub contents failed ${response.status} ${response.statusText}: ${url}`,
    );
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`GitHub contents path is not a directory: ${url}`);
  }
  return payload;
}

async function collectGithubTreeFiles(repo, treePath, rootPath = treePath) {
  const entries = await githubContents(repo, treePath);
  const files = [];

  for (const entry of entries) {
    if (entry.type === "file") {
      if (!entry.download_url) {
        throw new Error(`GitHub file has no download_url: ${entry.path}`);
      }
      files.push({
        downloadUrl: entry.download_url,
        relativePath: path.posix.relative(rootPath, entry.path),
      });
    } else if (entry.type === "dir") {
      files.push(...(await collectGithubTreeFiles(repo, entry.path, rootPath)));
    }
  }

  return files;
}

async function fetchGithubTree(model, targetPath) {
  if (!model.repo || !model.treePath) {
    throw new Error(`${model.id} github-tree requires repo and treePath`);
  }

  const targetDir = resolveRepoPath(model.targetDir ?? path.dirname(model.path));
  const files = await collectGithubTreeFiles(model.repo, model.treePath);
  if (files.length === 0) {
    throw new Error(`${model.id} GitHub tree is empty: ${model.treePath}`);
  }

  console.log(
    `[samples] github-tree ${model.id}: ${model.repo}/${model.treePath} (${files.length} files)`,
  );
  await mkdir(targetDir, { recursive: true });

  for (const file of files) {
    const outputPath = path.join(targetDir, file.relativePath);
    console.log(`[samples] file ${model.id}: ${file.relativePath}`);
    await download(file.downloadUrl, outputPath);
  }

  if (!(await stat(targetPath).catch(() => null))?.isFile()) {
    throw new Error(`GitHub tree did not produce target file: ${model.path}`);
  }
}

async function fetchArchive(model, targetPath) {
  const archivePath = path.join(
    tmpRoot,
    `${model.id}${path.extname(model.url) || ".zip"}`,
  );
  const extractDir = path.join(tmpRoot, model.id);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  await download(model.url, archivePath);

  const extractAttempts =
    process.platform === "win32"
      ? [["tar", ["-xf", archivePath, "-C", extractDir]]]
      : [
          ["unzip", ["-o", "-q", archivePath, "-d", extractDir]],
          ["tar", ["-xf", archivePath, "-C", extractDir]],
        ];

  let extractError = null;
  for (const [command, args] of extractAttempts) {
    try {
      await run(command, args, repoRoot);
      extractError = null;
      break;
    } catch (tarError) {
      extractError = tarError;
    }
  }
  if (extractError) {
    throw new Error(
      `${model.id} zip extraction failed. Manual fallback: download ${model.url} and extract it so ${model.path} exists. Cause: ${
        describeError(extractError)
      }`,
    );
  }

  const found = await findByBasename(extractDir, path.basename(targetPath));
  if (!found) {
    throw new Error(
      `archive did not contain ${path.basename(targetPath)}: ${model.url}`,
    );
  }

  const sourceDir = path.dirname(found);
  const targetDir = path.dirname(targetPath);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

async function fetchFile(model, targetPath) {
  const tmpPath = path.join(tmpRoot, `${model.id}.download`);
  await download(model.url, tmpPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rename(tmpPath, targetPath);
}

async function verifyModel(model, targetPath) {
  const actual = await sha256(targetPath);
  const expectedSha = expectedValue(model.sha256);
  if (expectedSha && actual !== expectedSha) {
    throw new Error(
      `${model.id} sha256 mismatch: expected ${expectedSha}, got ${actual}`,
    );
  }

  const size = (await stat(targetPath)).size;
  const expectedSize = expectedValue(model.sizeBytes);
  if (expectedSize && size !== Number(expectedSize)) {
    throw new Error(
      `${model.id} size mismatch: expected ${expectedSize}, got ${size}`,
    );
  }

  if (!expectedSha) {
    console.log(`[samples] sha256 ${model.id}: ${actual}`);
  }
  if (!expectedSize) {
    console.log(`[samples] size ${model.id}: ${size}`);
  }
  console.log(`[samples] ready ${model.id}: ${model.path}`);
}

async function fetchModel(model) {
  const targetPath = resolveRepoPath(model.path);
  if ((await stat(targetPath).catch(() => null))?.isFile()) {
    console.log(`[samples] exists ${model.id}: ${model.path}`);
  } else if (model.kind === "github-tree") {
    await fetchGithubTree(model, targetPath);
  } else if (model.kind === "zip") {
    console.log(`[samples] zip ${model.id}: ${model.url}`);
    await fetchArchive(model, targetPath);
  } else if (model.kind === "single") {
    console.log(`[samples] file ${model.id}: ${model.url}`);
    await fetchFile(model, targetPath);
  } else {
    throw new Error(
      `${model.id} has unsupported kind '${model.kind}'. Expected single, github-tree, or zip.`,
    );
  }

  await verifyModel(model, targetPath);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const args = process.argv.slice(2);
const caseIndex = args.indexOf("--case");
if (
  caseIndex !== -1 &&
  (!args[caseIndex + 1] || args[caseIndex + 1].startsWith("--"))
) {
  throw new Error("--case requires a sample id");
}
const selectedCaseId = caseIndex === -1 ? null : args[caseIndex + 1];
const models = selectedCaseId
  ? manifest.models.filter((model) => model.id === selectedCaseId)
  : manifest.models;

if (selectedCaseId && models.length === 0) {
  throw new Error(`unknown sample case: ${selectedCaseId}`);
}

await mkdir(tmpRoot, { recursive: true });

const failures = [];

try {
  for (const model of models) {
    try {
      await fetchModel(model);
    } catch (error) {
      const message = describeError(error);
      failures.push({ id: model.id, message });
      console.warn(`[samples] WARN ${model.id}: ${message}`);
    }
  }
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.warn(`[samples] completed with ${failures.length} failure(s):`);
  for (const failure of failures) {
    console.warn(`[samples] - ${failure.id}: ${failure.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[samples] completed ${models.length} model(s)`);
}
