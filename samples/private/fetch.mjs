import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  copyFile,
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
  if (!resolved.startsWith(repoRoot + path.sep)) {
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

async function download(url, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed ${response.status} ${response.statusText}: ${url}`);
  }
  await pipeline(response.body, createWriteStream(outputPath));
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

async function fetchArchive(model, targetPath) {
  const archivePath = path.join(tmpRoot, `${model.id}${path.extname(model.url) || ".zip"}`);
  const extractDir = path.join(tmpRoot, model.id);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  await download(model.url, archivePath);
  await run("tar", ["-xf", archivePath, "-C", extractDir], repoRoot);
  const found = await findByBasename(extractDir, path.basename(targetPath));
  if (!found) {
    throw new Error(`archive did not contain ${path.basename(targetPath)}: ${model.url}`);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(found, targetPath);
}

async function fetchFile(model, targetPath) {
  const tmpPath = path.join(tmpRoot, `${model.id}.download`);
  await download(model.url, tmpPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rename(tmpPath, targetPath);
}

async function fetchModel(model) {
  const targetPath = resolveRepoPath(model.path);
  if ((await stat(targetPath).catch(() => null))?.isFile()) {
    console.log(`[samples] exists ${model.id}: ${model.path}`);
  } else if (model.url.toLowerCase().endsWith(".zip")) {
    console.log(`[samples] archive ${model.id}: ${model.url}`);
    await fetchArchive(model, targetPath);
  } else {
    console.log(`[samples] file ${model.id}: ${model.url}`);
    await fetchFile(model, targetPath);
  }

  const actual = await sha256(targetPath);
  if (model.sha256 && actual !== model.sha256) {
    throw new Error(
      `${model.id} sha256 mismatch: expected ${model.sha256}, got ${actual}`,
    );
  }

  const size = (await stat(targetPath)).size;
  if (model.sizeBytes && size !== model.sizeBytes) {
    throw new Error(
      `${model.id} size mismatch: expected ${model.sizeBytes}, got ${size}`,
    );
  }

  console.log(`[samples] ready ${model.id}: ${model.path} (${size} bytes, ${actual})`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(tmpRoot, { recursive: true });

try {
  for (const model of manifest.models) {
    await fetchModel(model);
  }
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}
