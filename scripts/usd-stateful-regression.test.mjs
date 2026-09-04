import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  assertPngDimensions,
  updateSnapshots,
  validateSnapshots,
  verifyPayloadRelationships,
  verifyReport,
} from "./usd-stateful-regression.mjs";

function png(width, height, value = 0) {
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 4, "ascii");
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height, value);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const scenario = {
  cases: [
    { id: "payload", captures: [{ id: "loaded", expectedDiagnostics: [] }] },
  ],
};
const goodReport = {
  cases: [
    {
      id: "payload",
      captures: [
        {
          id: "loaded",
          error: null,
          operationDiagnostics: [],
          extractionDiagnostics: [],
        },
      ],
    },
  ],
};

test("missing baseline fails normally and update creates it", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "yw-look-usd-stateful-"),
  );
  try {
    const capture = {
      id: "loaded",
      pngPath: path.join(tempDir, "actual.png"),
      glbPath: path.join(tempDir, "actual.glb"),
      snapshotPath: path.join(tempDir, "baseline.png"),
    };
    await writeFile(capture.pngPath, png(384, 288));
    await writeFile(capture.glbPath, "glb");
    await assert.rejects(
      () => validateSnapshots([capture], false),
      /snapshot is missing/,
    );
    await validateSnapshots([capture], true);
    await updateSnapshots([capture]);
    assert.deepEqual(
      await readFile(capture.snapshotPath),
      await readFile(capture.pngPath),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("capture errors are not masked by update mode", () => {
  const report = structuredClone(goodReport);
  report.cases[0].captures[0].error = "extract failed";
  assert.throws(() => verifyReport(scenario, report), /capture failed/);
});

test("diagnostics must match exactly", () => {
  const report = structuredClone(goodReport);
  report.cases[0].captures[0].operationDiagnostics = ["unexpected"];
  assert.throws(() => verifyReport(scenario, report), /diagnostics mismatch/);
});

test("actual and baseline dimensions are independently strict", () => {
  assert.throws(
    () => assertPngDimensions(png(1, 1), "actual"),
    /actual dimensions/,
  );
  assert.throws(
    () => assertPngDimensions(png(1, 1), "baseline"),
    /baseline dimensions/,
  );
});

test("bad baseline dimensions fail before update", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "yw-look-usd-stateful-"),
  );
  try {
    const capture = {
      id: "loaded",
      pngPath: path.join(tempDir, "actual.png"),
      glbPath: path.join(tempDir, "actual.glb"),
      snapshotPath: path.join(tempDir, "baseline.png"),
    };
    await writeFile(capture.pngPath, png(384, 288));
    await writeFile(capture.glbPath, "glb");
    await writeFile(capture.snapshotPath, png(1, 1));
    const original = await readFile(capture.snapshotPath);
    await assert.rejects(
      () => validateSnapshots([capture], true),
      /baseline loaded dimensions/,
    );
    assert.deepEqual(await readFile(capture.snapshotPath), original);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("payload relation failure leaves existing baselines unchanged", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "yw-look-usd-stateful-"),
  );
  try {
    const baselinePath = path.join(tempDir, "loaded.png");
    const original = png(384, 288, 1);
    await writeFile(baselinePath, original);
    const captures = ["loaded", "unloaded", "reloaded"].map((id) => ({
      id,
      glb: Buffer.from(id === "unloaded" ? "different" : "same"),
      png: png(384, 288, id === "unloaded" ? 2 : 1),
      meshes: ["/Root/InlineMesh"],
      nodes: ["InlineMesh"],
      pngPath: path.join(tempDir, `${id}.png`),
      snapshotPath: baselinePath,
    }));
    assert.throws(
      () => verifyPayloadRelationships(captures),
      /payload mesh\/node evidence/,
    );
    assert.deepEqual(await readFile(baselinePath), original);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
