/**
 * tests/fixtures/_generate.mjs
 *
 * Deterministic fixture generator for yw-look tests.
 * Run: node tests/fixtures/_generate.mjs
 *
 * Generates:
 *   textures/1x1.png, textures/1x1.jpg
 *   models/animated-triangle.fbx
 *   broken/* error-matrix fixtures for B8 (beta error visualization)
 */

import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const texturesDir = join(__dirname, "textures");
const modelsDir = join(__dirname, "models");
const brokenDir = join(__dirname, "broken");
mkdirSync(texturesDir, { recursive: true });
mkdirSync(modelsDir, { recursive: true });
mkdirSync(brokenDir, { recursive: true });

// FBX KTime units per second (Three.js FBXLoader convention).
const FBX_KTIME_PER_SECOND = 46186158000;

// -----------------------------------------------------------------------
// PNG helpers
// -----------------------------------------------------------------------

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

function makePng(r, g, b, a = 255) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const raw = Buffer.from([0, r, g, b, a]);
  const compressed = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdrData),
    chunk("IDAT", Buffer.from(compressed)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// -----------------------------------------------------------------------
// GLB helpers
// -----------------------------------------------------------------------

function align4(buffer, padByte = 0) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding === 0
    ? buffer
    : Buffer.concat([buffer, Buffer.alloc(padding, padByte)]);
}

function makeGlb(json, binData = Buffer.alloc(0)) {
  const jsonChunk = align4(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = binData.length > 0 ? align4(binData, 0) : null;
  const totalLength =
    12 + 8 + jsonChunk.length + (binChunk ? 8 + binChunk.length : 0);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);

  const parts = [header, jsonHeader, jsonChunk];
  if (binChunk) {
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binChunk.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    parts.push(binHeader, binChunk);
  }
  return Buffer.concat(parts);
}

function makeTriangleGlb({ scale, generator = "yw-look fixture" }) {
  const s = scale;
  const positions = new Float32Array([0, 0, 0, s, 0, 0, 0, s, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const bin = Buffer.alloc(positions.byteLength + indices.byteLength);
  Buffer.from(positions.buffer).copy(bin, 0);
  Buffer.from(indices.buffer).copy(bin, positions.byteLength);

  const json = {
    asset: { version: "2.0", generator },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [s, s, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
      },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  return makeGlb(json, bin);
}

function writeText(path, text) {
  writeFileSync(path, text, "utf8");
  console.log(`Written: ${path}`);
}

function writeBinary(path, data) {
  writeFileSync(path, data);
  console.log(`Written: ${path}`);
}

// -----------------------------------------------------------------------
// FBX helpers (ASCII 7.4, minimal animated triangle)
// -----------------------------------------------------------------------

function fbxArrayProperty(name, values, indentLevel = 2) {
  const pad = "\t".repeat(indentLevel);
  const inner = "\t".repeat(indentLevel + 1);
  return `${pad}${name}: *${values.length} {\n${inner}a: ${values.join(",")}\n${pad}}`;
}

function makeAnimatedTriangleFbxAscii() {
  const oneSecond = FBX_KTIME_PER_SECOND;
  const ids = {
    model: 100,
    geometry: 101,
    animStack: 200,
    animLayer: 201,
    curveNodeT: 210,
    curveX: 211,
    curveY: 212,
    curveZ: 213,
  };

  const keyTimes = [0, oneSecond];
  const keyTimesBlock = fbxArrayProperty("KeyTime", keyTimes, 2);
  const curveXValues = fbxArrayProperty("KeyValueFloat", [0, 0], 2);
  const curveYValues = fbxArrayProperty("KeyValueFloat", [0, 1], 2);
  const curveZValues = fbxArrayProperty("KeyValueFloat", [0, 0], 2);

  return `; FBX 7.4.0 project file
; yw-look fixture: minimal animated triangle (_generate.mjs)

FBXHeaderExtension: {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreator: "yw-look fixture generator"
}

GlobalSettings: {
\tVersion: 1000
\tProperties70: {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "FrontAxis", "int", "Integer", "",2
\t\tP: "CoordAxis", "int", "Integer", "",0
\t\tP: "UnitScaleFactor", "double", "Number", "",1
\t}
}

Documents: {
\tCount: 1
\tDocument: 1, "", "Scene" {
\t\tProperties70: {
\t\t\tP: "ActiveAnimStackName", "KString", "", "", "FixtureTake"
\t\t}
\t\tRootNode: 0
\t}
}

Definitions: {
\tVersion: 100
\tCount: 6
\tObjectType: "Model" {
\t\tCount: 1
\t}
\tObjectType: "Geometry" {
\t\tCount: 1
\t}
\tObjectType: "AnimationStack" {
\t\tCount: 1
\t}
\tObjectType: "AnimationLayer" {
\t\tCount: 1
\t}
\tObjectType: "AnimationCurveNode" {
\t\tCount: 1
\t}
\tObjectType: "AnimationCurve" {
\t\tCount: 3
\t}
}

Objects: {
\tGeometry: ${ids.geometry}, "Geometry::Triangle", "Mesh" {
${fbxArrayProperty("Vertices", [0, 0, 0, 1, 0, 0, 0, 1, 0], 2)}
${fbxArrayProperty("PolygonVertexIndex", [0, 1, -3], 2)}
\t\tGeometryVersion: 124
\t\tLayerElementNormal: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "Direct"
${fbxArrayProperty("Normals", [0, 0, 1], 3)}
\t\t}
\t\tLayer: 0 {
\t\t\tVersion: 100
\t\t\tLayerElement: {
\t\t\t\tType: "LayerElementNormal"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t}
\t}
\tModel: ${ids.model}, "Model::AnimatedTriangle", "Mesh" {
\t\tVersion: 232
\t\tProperties70: {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
\t\t}
\t}
\tAnimationStack: ${ids.animStack}, "AnimStack::FixtureTake", "" {
\t\tProperties70: {
\t\t\tP: "LocalStart", "KTime", "Time", "",0
\t\t\tP: "LocalStop", "KTime", "Time", "",${oneSecond}
\t\t}
\t}
\tAnimationLayer: ${ids.animLayer}, "AnimLayer::BaseLayer", "" {
\t}
\tAnimationCurveNode: ${ids.curveNodeT}, "AnimCurveNode::T", "" {
\t\tProperties70: {
\t\t\tP: "d|X", "Number", "", "A",0
\t\t\tP: "d|Y", "Number", "", "A",0
\t\t\tP: "d|Z", "Number", "", "A",0
\t\t}
\t}
\tAnimationCurve: ${ids.curveX}, "AnimCurve::X", "" {
\t\tDefault: 0
\t\tKeyVer: 4009
${keyTimesBlock}
${curveXValues}
\t}
\tAnimationCurve: ${ids.curveY}, "AnimCurve::Y", "" {
\t\tDefault: 0
\t\tKeyVer: 4009
${keyTimesBlock}
${curveYValues}
\t}
\tAnimationCurve: ${ids.curveZ}, "AnimCurve::Z", "" {
\t\tDefault: 0
\t\tKeyVer: 4009
${keyTimesBlock}
${curveZValues}
\t}
}

Connections: {
\tC: "OO",${ids.model},0
\tC: "OO",${ids.geometry},${ids.model}
\tC: "OO",${ids.animStack},0
\tC: "OO",${ids.animLayer},${ids.animStack}
\tC: "OO",${ids.curveNodeT},${ids.animLayer}
\tC: "OP",${ids.curveNodeT},${ids.model},"Lcl Translation"
\tC: "OP",${ids.curveX},${ids.curveNodeT},"d|X"
\tC: "OP",${ids.curveY},${ids.curveNodeT},"d|Y"
\tC: "OP",${ids.curveZ},${ids.curveNodeT},"d|Z"
}
`;
}

// -----------------------------------------------------------------------
// textures/1x1.png, textures/1x1.jpg
// -----------------------------------------------------------------------

const pngPath = join(texturesDir, "1x1.png");
writeBinary(pngPath, makePng(255, 0, 0, 255));

const jpgBytes = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==",
  "base64",
);
writeBinary(join(texturesDir, "1x1.jpg"), jpgBytes);

// -----------------------------------------------------------------------
// B8 error-matrix fixtures (tests/fixtures/broken/)
// -----------------------------------------------------------------------

// unsupported-format: unknown extension
writeText(
  join(brokenDir, "model.xyz"),
  "# yw-look B8 fixture: unsupported extension\nnot a real model\n",
);

// unsupported-format: PNG bytes with .glb extension
writeBinary(join(brokenDir, "png-as-glb.glb"), readFileSync(pngPath));

// load-failure: truncated GLB
const validGlb = makeTriangleGlb({
  scale: 1,
  generator: "yw-look truncated fixture",
});
writeBinary(
  join(brokenDir, "truncated.glb"),
  validGlb.subarray(0, Math.floor(validGlb.length / 2)),
);

// load-failure: invalid USDA syntax
writeText(
  join(brokenDir, "broken.usda"),
  `#usda 1.0
(
    defaultPrim = "Root"
    doc = "yw-look B8 fixture. Intentionally invalid USDA syntax."
    unclosed =
`,
);

// reference-resolution-failure: glTF with missing external buffer
writeText(
  join(brokenDir, "missing-buffer.gltf"),
  JSON.stringify(
    {
      asset: { version: "2.0", generator: "yw-look B8 fixture" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [{ attributes: { POSITION: 0 } }],
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
        },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ uri: "missing-buffer.bin", byteLength: 36 }],
    },
    null,
    2,
  ) + "\n",
);

// reference-resolution-failure: USDA with broken reference
writeText(
  join(brokenDir, "missing-ref.usda"),
  `#usda 1.0
(
    defaultPrim = "Root"
    doc = "yw-look B8 fixture. References a non-existent sibling USDA file."
)

def Xform "Root" (
    kind = "assembly"
)
{
    def Xform "BrokenChild" (
        references = @./does_not_exist.usda@</Root>
    )
    {
    }
}
`,
);

// reference-resolution-failure: USDA with broken payload
writeText(
  join(brokenDir, "missing-payload.usda"),
  `#usda 1.0
(
    defaultPrim = "Root"
    doc = "yw-look B8 fixture. Payload points to a non-existent sibling USDA file."
)

def Xform "Root" (
    kind = "assembly"
)
{
    def Xform "PayloadChild" (
        payload = @./missing_payload_layer.usda@</Root>
    )
    {
    }
}
`,
);

// missing-texture: glTF with missing image
writeText(
  join(brokenDir, "missing-texture.gltf"),
  JSON.stringify(
    {
      asset: { version: "2.0", generator: "yw-look B8 fixture" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0 },
              indices: 1,
              material: 0,
            },
          ],
        },
      ],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
          },
        },
      ],
      textures: [{ source: 0 }],
      images: [{ uri: "missing-albedo.png" }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        {
          bufferView: 1,
          componentType: 5123,
          count: 3,
          type: "SCALAR",
        },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      buffers: [
        {
          byteLength: 44,
          uri: "data:application/octet-stream;base64,AACAvwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAAACAAQA",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);

// missing-texture: OBJ + MTL referencing absent texture
writeText(
  join(brokenDir, "missing-texture.obj"),
  `mtllib missing-texture.mtl
o Triangle
v 0 0 0
v 1 0 0
v 0 1 0
usemtl Material
f 1 2 3
`,
);
writeText(
  join(brokenDir, "missing-texture.mtl"),
  `newmtl Material
map_Kd missing-albedo.png
`,
);

// scale-warning: extremely small / large GLB geometry
writeBinary(
  join(brokenDir, "scale-tiny.glb"),
  makeTriangleGlb({ scale: 0.0001, generator: "yw-look scale-tiny fixture" }),
);
writeBinary(
  join(brokenDir, "scale-huge.glb"),
  makeTriangleGlb({ scale: 20000, generator: "yw-look scale-huge fixture" }),
);

// -----------------------------------------------------------------------
// models/animated-triangle.fbx
// -----------------------------------------------------------------------

writeText(
  join(modelsDir, "animated-triangle.fbx"),
  makeAnimatedTriangleFbxAscii(),
);

console.log(
  "Done. Fixture textures, animated FBX, and B8 broken fixtures generated.",
);
