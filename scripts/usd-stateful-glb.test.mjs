import assert from "node:assert/strict";
import test from "node:test";
import { verifyGlbFeatures } from "./usd-stateful-glb.mjs";

const linear = (value) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

function align4(bytes, padByte = 0) {
  return Buffer.concat([
    bytes,
    Buffer.alloc((4 - (bytes.length % 4)) % 4, padByte),
  ]);
}

function makeGlb(json, bin) {
  const jsonChunk = align4(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = align4(bin);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

function builder() {
  let bin = Buffer.alloc(0);
  const views = [];
  const accessors = [];
  function add(values, type, componentType) {
    const width = { 5123: 2, 5125: 4, 5126: 4 }[componentType];
    const flat = type === "SCALAR" ? values : values.flat();
    const bytes = Buffer.alloc(flat.length * width);
    flat.forEach((value, index) => {
      const offset = index * width;
      if (componentType === 5123) bytes.writeUInt16LE(value, offset);
      else if (componentType === 5125) bytes.writeUInt32LE(value, offset);
      else bytes.writeFloatLE(value, offset);
    });
    bin = Buffer.concat([align4(bin), bytes]);
    const view = views.length;
    views.push({
      buffer: 0,
      byteOffset: bin.length - bytes.length,
      byteLength: bytes.length,
    });
    const accessor = accessors.length;
    accessors.push({
      bufferView: view,
      componentType,
      count: values.length,
      type,
    });
    return accessor;
  }
  function finish(extra) {
    return makeGlb(
      {
        asset: { version: "2.0" },
        ...extra,
        accessors,
        bufferViews: views,
        buffers: [{ byteLength: bin.length }],
      },
      bin,
    );
  }
  return { add, finish };
}

function materialGlb(swapped = false) {
  const b = builder();
  const positions = [
    b.add(
      [
        [-2, 0, -1],
        [0, 0, -1],
        [0, 0, 1],
        [-2, 0, 1],
        [-2, 0, -1],
        [0, 0, 1],
      ],
      "VEC3",
      5126,
    ),
    b.add(
      [
        [0.1, 0, -1],
        [2, 0, -1],
        [2, 0, 1],
        [0.1, 0, -1],
        [2, 0, 1],
        [0.1, 0, 1],
      ],
      "VEC3",
      5126,
    ),
  ];
  const indices = [
    b.add([0, 1, 2, 3, 4, 5], "SCALAR", 5125),
    b.add([0, 1, 2, 3, 4, 5], "SCALAR", 5125),
  ];
  const red = [0.85, 0.05, 0.03, 1].map((v, i) => (i < 3 ? linear(v) : v));
  const blue = [0.03, 0.15, 0.9, 1].map((v, i) => (i < 3 ? linear(v) : v));
  return b.finish({
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0 }, { mesh: 1 }],
    meshes: [
      {
        name: "/Root/MaterialSubsetPanel/RedFace",
        primitives: [
          {
            attributes: { POSITION: positions[0] },
            indices: indices[0],
            material: swapped ? 2 : 1,
          },
        ],
      },
      {
        name: "/Root/MaterialSubsetPanel/BlueFace",
        primitives: [
          {
            attributes: { POSITION: positions[1] },
            indices: indices[1],
            material: swapped ? 1 : 2,
          },
        ],
      },
    ],
    materials: [
      {
        name: "default",
        pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1] },
      },
      { name: "red", pbrMetallicRoughness: { baseColorFactor: red } },
      { name: "blue", pbrMetallicRoughness: { baseColorFactor: blue } },
    ],
  });
}

function normalsGlb(lost = false) {
  const b = builder();
  const positions = b.add(
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    "VEC3",
    5126,
  );
  const normals = b.add(
    Array.from({ length: 6 }, () => (lost ? [0, -1, 0] : [0, 0.6, 0.8])),
    "VEC3",
    5126,
  );
  return b.finish({
    meshes: [
      {
        name: "/Root/AuthoredTiltedQuad",
        primitives: [{ attributes: { POSITION: positions, NORMAL: normals } }],
      },
    ],
  });
}

function skinningGlb({
  badWeights = false,
  badJoint = false,
  disconnected = false,
  positionMismatch = false,
} = {}) {
  const b = builder();
  const position = b.add(
    Array.from({ length: positionMismatch ? 5 : 6 }, () => [0, 0, 0]),
    "VEC3",
    5126,
  );
  const joints = b.add(
    Array.from({ length: 6 }, () => (badJoint ? [0, 2, 0, 0] : [0, 1, 0, 0])),
    "VEC4",
    5123,
  );
  const weights = b.add(
    Array.from({ length: 6 }, () =>
      badWeights ? [0.8, 0, 0, 0] : [1, 0, 0, 0],
    ),
    "VEC4",
    5126,
  );
  const ibm = b.add(
    [
      Array(16)
        .fill(0)
        .map((_, i) => (i % 5 === 0 ? 1 : 0)),
      Array(16)
        .fill(0)
        .map((_, i) => (i % 5 === 0 ? 1 : 0)),
    ],
    "MAT4",
    5126,
  );
  return b.finish({
    nodes: [
      { mesh: 0, ...(disconnected ? {} : { skin: 0 }) },
      { name: "Hip" },
      { name: "Spine" },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              POSITION: position,
              JOINTS_0: joints,
              WEIGHTS_0: weights,
            },
          },
        ],
      },
    ],
    skins: [{ joints: [1, 2], inverseBindMatrices: ibm }],
    animations: [{ channels: Array.from({ length: 6 }, () => ({})) }],
  });
}

function pointInstancerGlb({ badCount = false, badLocation = false } = {}) {
  const b = builder();
  const cubeX = badCount ? [-3, -0.6] : [-3, -0.6, 1.8];
  const pyramidX = badLocation ? [-1.8, 2.5] : [-1.8, 3];
  const cube = b.add(
    cubeX.map((x) => [x, 0, 0]),
    "VEC3",
    5126,
  );
  const pyramid = b.add(
    pyramidX.map((x) => [x, 0, 0]),
    "VEC3",
    5126,
  );
  const extension = (translation) => ({
    EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: translation } },
  });
  return b.finish({
    nodes: [
      { mesh: 0, extensions: extension(cube) },
      { mesh: 1, extensions: extension(pyramid) },
    ],
    meshes: [
      { name: "/Root/Instancer/PrototypeCube", primitives: [{}] },
      { name: "/Root/Instancer/PrototypePyramid", primitives: [{}] },
    ],
  });
}

test("unknown GLB profile fails closed", () => {
  assert.throws(
    () => verifyGlbFeatures("unknown", Buffer.alloc(0)),
    /unknown GLB feature profile/,
  );
});

test("synthetic positive builders satisfy all four profiles", () => {
  for (const [profile, buffer] of [
    ["material-subsets", materialGlb()],
    ["authored-normals", normalsGlb()],
    ["skinning", skinningGlb()],
    ["point-instancer", pointInstancerGlb()],
  ]) {
    assert.equal(verifyGlbFeatures(profile, buffer).profile, profile);
  }
});

test("material subset assignment errors are detected", () => {
  assert.throws(
    () => verifyGlbFeatures("material-subsets", materialGlb(true)),
    /material color is incorrect/,
  );
});

test("authored normals disappearance is detected", () => {
  assert.throws(
    () => verifyGlbFeatures("authored-normals", normalsGlb(true)),
    /authored tilted normals were lost/,
  );
});

test("skinning weight and joint range errors are detected", () => {
  assert.throws(
    () => verifyGlbFeatures("skinning", skinningGlb({ badWeights: true })),
    /weights are not normalized/,
  );
  assert.throws(
    () => verifyGlbFeatures("skinning", skinningGlb({ badJoint: true })),
    /joint index out of range/,
  );
});

test("point instance count and location errors are detected", () => {
  assert.throws(
    () =>
      verifyGlbFeatures(
        "point-instancer",
        pointInstancerGlb({ badCount: true }),
      ),
    /instance translations are incorrect/,
  );
  assert.throws(
    () =>
      verifyGlbFeatures(
        "point-instancer",
        pointInstancerGlb({ badLocation: true }),
      ),
    /instance translations are incorrect/,
  );
});

test("disconnected skin is detected", () => {
  assert.throws(
    () => verifyGlbFeatures("skinning", skinningGlb({ disconnected: true })),
    /skin node binding/,
  );
});

test("skinning attribute count mismatch is detected", () => {
  assert.throws(
    () =>
      verifyGlbFeatures("skinning", skinningGlb({ positionMismatch: true })),
    /POSITION, JOINTS_0, and WEIGHTS_0 counts differ/,
  );
});
