import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  assertPngDimensions,
  classifyReport,
  runCaptureGate,
  updateSnapshots,
  validateScenarioCases,
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

const variantFailureMessage =
  "USD_INVALID_VARIANT_SELECTION\tprimPath=/Root\tsetName=look\tvariantName=blue";
const expectedVariantFailure = {
  origin: "extraction",
  code: "USD_INVALID_VARIANT_SELECTION",
  message: variantFailureMessage,
  reason: "variant override is an approved backend capability gap",
};

function expectedFailureScenario(expectedFailure = expectedVariantFailure) {
  return {
    cases: [
      {
        id: "variant",
        relationship: "independent",
        captures: [
          {
            id: "override",
            expectedDiagnostics: [variantFailureMessage],
            expectedFailure,
          },
        ],
      },
    ],
  };
}

function variantFailureReport(message = variantFailureMessage, failure = {}) {
  return {
    cases: [
      {
        id: "variant",
        captures: [
          {
            id: "override",
            error: message,
            operationDiagnostics: [],
            extractionDiagnostics: [message],
            failure: {
              origin: "extraction",
              code: "USD_INVALID_VARIANT_SELECTION",
              message,
              detail: "primPath=/Root;setName=look;variantName=blue",
              ...failure,
            },
          },
        ],
      },
    ],
  };
}

test("matching typed expected failure is XFAIL", () => {
  const summary = classifyReport(
    expectedFailureScenario(),
    variantFailureReport(),
  );
  assert.deepEqual(summary.counts, { PASS: 0, XFAIL: 1, FAIL: 0, XPASS: 0 });
  assert.equal(summary.records[0].status, "XFAIL");
  assert.match(summary.records[0].detail, /approved backend capability gap/);
  assert.doesNotThrow(() =>
    verifyReport(expectedFailureScenario(), variantFailureReport()),
  );
});

test("wrong expected failure origin, code, or message is a hard FAIL", () => {
  const wrongOrigin = expectedFailureScenario({
    ...expectedVariantFailure,
    origin: "operation",
  });
  assert.equal(
    classifyReport(wrongOrigin, variantFailureReport()).records[0].status,
    "FAIL",
  );
  const wrongCode = expectedFailureScenario({
    ...expectedVariantFailure,
    code: "USD_BACKEND_PARSE",
  });
  assert.equal(
    classifyReport(wrongCode, variantFailureReport()).records[0].status,
    "FAIL",
  );
  const wrongMessage = expectedFailureScenario({
    ...expectedVariantFailure,
    message: "different typed message",
  });
  assert.equal(
    classifyReport(wrongMessage, variantFailureReport()).records[0].status,
    "FAIL",
  );
});

test("typed XFAIL also requires error text to match structured failure", () => {
  const report = variantFailureReport();
  report.cases[0].captures[0].error = "different error text";
  assert.equal(
    classifyReport(expectedFailureScenario(), report).records[0].status,
    "FAIL",
  );
});

test("unrelated IO and parse failures remain hard failures", () => {
  const scenarioWithNoExpectation = expectedFailureScenario(null);
  scenarioWithNoExpectation.cases[0].captures[0].expectedDiagnostics = [
    "USD backend io error: missing.usda",
  ];
  const report = variantFailureReport("USD backend io error: missing.usda", {
    origin: "extraction",
    code: "USD_BACKEND_IO",
  });
  assert.equal(
    classifyReport(scenarioWithNoExpectation, report).records[0].status,
    "FAIL",
  );
  report.cases[0].captures[0].failure = {
    origin: "extraction",
    code: "USD_BACKEND_PARSE",
    message: "USD backend parse error: malformed",
    detail: "malformed",
  };
  report.cases[0].captures[0].error = "USD backend parse error: malformed";
  report.cases[0].captures[0].extractionDiagnostics = [
    "USD backend parse error: malformed",
  ];
  scenarioWithNoExpectation.cases[0].captures[0].expectedDiagnostics = [
    "USD backend parse error: malformed",
  ];
  assert.throws(
    () => verifyReport(scenarioWithNoExpectation, report),
    /capture failed/,
  );
});

test("successful extraction with an expected failure is XPASS", () => {
  const report = {
    cases: [
      {
        id: "variant",
        captures: [
          {
            id: "override",
            error: null,
            operationDiagnostics: [],
            extractionDiagnostics: [],
          },
        ],
      },
    ],
  };
  const summary = classifyReport(expectedFailureScenario(), report);
  assert.deepEqual(summary.counts, { PASS: 0, XFAIL: 0, FAIL: 0, XPASS: 1 });
  assert.throws(
    () => verifyReport(expectedFailureScenario(), report),
    /expected failure passed unexpectedly/,
  );
});

test("expected failure declarations are validated fail closed", () => {
  assert.throws(
    () =>
      validateScenarioCases([
        {
          id: "case",
          relationship: "independent",
          captures: [
            {
              id: "capture",
              expectedFailure: {
                origin: "adapter",
                code: "USD_STATEFUL_TIMECODE_UNSUPPORTED",
                reason: "",
                message: "unsupported",
              },
            },
          ],
        },
      ]),
    /expectedFailure.reason must be non-empty/,
  );
  assert.throws(
    () =>
      validateScenarioCases([
        {
          id: "case",
          relationship: "independent",
          captures: [
            {
              id: "capture",
              expectedFailure: {
                origin: "adapter",
                code: "USD_STATEFUL_TIMECODE_UNSUPPORTED",
                reason: "unsupported",
                message: "unsupported",
                extra: "unknown field",
              },
            },
          ],
        },
      ]),
    /unknown expectedFailure field/,
  );
});

test("update mode reaches the shared PASS capture gate", async () => {
  const calls = [];
  const captures = [{ id: "passing", status: "PASS" }];
  const selected = [
    {
      id: "independent",
      relationship: "independent",
      captures: [{ id: "passing" }],
    },
  ];
  const result = await runCaptureGate(
    captures,
    selected,
    { update: true, shotBinary: null },
    {
      render: async (passing) => calls.push(["render", passing]),
      validateSnapshots: async (passing, update) =>
        calls.push(["validate", passing, update]),
      updateSnapshots: async (passing) => calls.push(["update", passing]),
    },
  );
  assert.deepEqual(result, captures);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["render", "validate", "update"],
  );
  assert.equal(calls[1][2], true);
});

test("XPASS is rejected before update mode can touch the capture gate", async () => {
  const calls = [];
  const captures = [{ id: "unexpected-pass", status: "XPASS" }];
  const selected = [
    {
      id: "independent",
      relationship: "independent",
      captures: [{ id: "unexpected-pass" }],
    },
  ];
  await assert.rejects(
    () =>
      runCaptureGate(
        captures,
        selected,
        { update: true, shotBinary: null },
        {
          render: async () => calls.push("render"),
          validateSnapshots: async () => calls.push("validate"),
          updateSnapshots: async () => calls.push("update"),
        },
      ),
    /XPASS capture cannot enter/,
  );
  assert.deepEqual(calls, []);
});

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
