import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const cases = [
  {
    id: "usda-tiny-sanity",
    input: "samples/assets/usd/tiny.usda",
    snapshot: "tests/visual/snapshots/viewport/usda-tiny-sanity.png",
    actual: "artifacts/screenshots/viewport/usda-tiny-sanity-current.png",
    size: "640x480",
    background: "default",
  },
];

const usage = `usage:
  npm run test:viewport-snapshot
  npm run test:viewport-snapshot -- --case <id>
  npm run test:viewport-snapshot:update
  UPDATE_SNAPSHOTS=1 npm run test:viewport-snapshot

Options:
  --case <id>          Run one viewport snapshot case.
  --update-snapshot    Replace baselines with the newly rendered PNGs.
  --list               Print available cases without running shot CLI.`;

const args = process.argv.slice(2);
const updateSnapshots =
  process.env.UPDATE_SNAPSHOTS === "1" || args.includes("--update-snapshot");
const listOnly = args.includes("--list");

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

let selectedCases = cases;
try {
  const selectedCaseId = readOption("--case");
  if (selectedCaseId) {
    selectedCases = cases.filter((testCase) => testCase.id === selectedCaseId);
    if (selectedCases.length === 0) {
      throw new Error(`unknown viewport snapshot case: ${selectedCaseId}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(2);
}

if (listOnly) {
  for (const testCase of selectedCases) {
    console.log(`${testCase.id}: ${testCase.input}`);
  }
  process.exit(0);
}

function resolveRepoPath(repoPath) {
  return path.resolve(repoRoot, repoPath);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

  return { width, height, colorType, pixels };
}

function comparePixels(actualBuffer, expectedBuffer) {
  const actual = decodePngPixels(actualBuffer);
  const expected = decodePngPixels(expectedBuffer);
  return (
    actual.width === expected.width &&
    actual.height === expected.height &&
    actual.colorType === expected.colorType &&
    Buffer.compare(actual.pixels, expected.pixels) === 0
  );
}

function runShot(testCase) {
  const shotArgs = [
    path.join(repoRoot, "scripts/run-shot.mjs"),
    "shot",
    "--in",
    resolveRepoPath(testCase.input),
    "--out",
    resolveRepoPath(testCase.actual),
    "--size",
    testCase.size,
    "--bg",
    testCase.background,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, shotArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        YW_LOOK_CARGO_NO_DEFAULT_FEATURES:
          process.env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES ?? "1",
        YW_LOOK_CARGO_FEATURES:
          process.env.YW_LOOK_CARGO_FEATURES ?? "backend-openusd-rs",
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`shot CLI was terminated by ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`shot CLI exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });

    child.on("error", reject);
  });
}

async function compareSnapshot(testCase) {
  const actualPath = resolveRepoPath(testCase.actual);
  const snapshotPath = resolveRepoPath(testCase.snapshot);
  const actualBuffer = await readFile(actualPath);

  if (updateSnapshots) {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await copyFile(actualPath, snapshotPath);
    console.log(`Updated viewport snapshot: ${testCase.snapshot}`);
    return;
  }

  let expectedBuffer;
  try {
    expectedBuffer = await readFile(snapshotPath);
  } catch {
    throw new Error(
      `Snapshot not found at ${testCase.snapshot}. Run UPDATE_SNAPSHOTS=1 npm run test:viewport-snapshot first.`,
    );
  }

  if (!comparePixels(actualBuffer, expectedBuffer)) {
    throw new Error(
      [
        `Viewport snapshot mismatch: ${testCase.id}`,
        `expected sha256: ${sha256(expectedBuffer)}`,
        `actual   sha256: ${sha256(actualBuffer)}`,
        `actual image: ${testCase.actual}`,
      ].join("\n"),
    );
  }

  console.log(`Viewport snapshot matched: ${testCase.id}`);
}

let failed = false;
for (const testCase of selectedCases) {
  try {
    await mkdir(path.dirname(resolveRepoPath(testCase.actual)), {
      recursive: true,
    });
    await rm(resolveRepoPath(testCase.actual), { force: true });
    console.log(`Rendering viewport snapshot: ${testCase.id}`);
    await runShot(testCase);
    await compareSnapshot(testCase);
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : String(error));
  }
}

if (failed) {
  process.exit(1);
}
