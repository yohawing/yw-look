import { writeFile } from "node:fs/promises";
import { SphereGeometry } from "three";
import { format } from "prettier";

// Shared sphere buffers keep this PBR comparison fixture small and reproducible.
const sphere = new SphereGeometry(0.8, 32, 16);
const arrays = [
  sphere.attributes.position.array,
  sphere.attributes.normal.array,
  sphere.index.array,
];
let byteLength = 0;
const bufferViews = arrays.map((array) => {
  const view = {
    buffer: 0,
    byteOffset: byteLength,
    byteLength: array.byteLength,
  };
  byteLength += array.byteLength;
  return view;
});
const bytes = Buffer.concat(
  arrays.map((array) =>
    Buffer.from(array.buffer, array.byteOffset, array.byteLength),
  ),
);
const materials = [0, 1].flatMap((metallicFactor) =>
  [0.08, 0.4, 0.85].map((roughnessFactor) => ({
    name: `Metal ${metallicFactor}, roughness ${roughnessFactor}`,
    pbrMetallicRoughness: {
      baseColorFactor: [0.7, 0.42, 0.2, 1],
      metallicFactor,
      roughnessFactor,
    },
  })),
);
const gltf = {
  asset: { version: "2.0", generator: "yw-look generate-lighting-fixture.mjs" },
  scene: 0,
  scenes: [{ nodes: [0, 1, 2, 3, 4, 5, 6] }],
  nodes: [
    ...materials.map((material, index) => ({
      name: material.name,
      mesh: index,
      translation: [((index % 3) - 1) * 2, index < 3 ? 1 : -1, 0],
    })),
    {
      name: "Authored fill light",
      rotation: [-0.25881904510252074, 0, 0, 0.9659258262890683],
      extensions: { KHR_lights_punctual: { light: 0 } },
    },
  ],
  extensionsUsed: ["KHR_lights_punctual"],
  extensions: {
    KHR_lights_punctual: {
      lights: [{ type: "directional", color: [0.6, 0.8, 1], intensity: 0.6 }],
    },
  },
  meshes: materials.map((_, material) => ({
    primitives: [
      { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material },
    ],
  })),
  materials,
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: sphere.attributes.position.count,
      type: "VEC3",
      min: [-0.8, -0.8, -0.8],
      max: [0.8, 0.8, 0.8],
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: sphere.attributes.normal.count,
      type: "VEC3",
    },
    {
      bufferView: 2,
      componentType: 5123,
      count: sphere.index.count,
      type: "SCALAR",
    },
  ],
  bufferViews,
  buffers: [
    {
      byteLength,
      uri: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
    },
  ],
};
await writeFile(
  new URL("../tests/fixtures/models/lighting.gltf", import.meta.url),
  await format(JSON.stringify(gltf), { parser: "json" }),
);
sphere.dispose();
