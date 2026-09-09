// Run with Node 22+: node --experimental-strip-types tests/fixtures/_generate-3mf.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { strToU8 } from "three/examples/jsm/libs/fflate.module.js";
import {
  tetraMesh,
  threeMfArchive,
} from "../../src/workers/__tests__/threeMfFixtures.ts";

mkdirSync("tests/fixtures/models/3mf", { recursive: true });
mkdirSync("tests/fixtures/broken/3mf", { recursive: true });
const save = (name, options) =>
  writeFileSync(
    `tests/fixtures/models/3mf/${name}.3mf`,
    new Uint8Array(threeMfArchive(options)),
  );
save("minimal", {});
save("centimeters", { unit: "centimeter" });
save("components", {
  resources: `<object id="1" name="Part">${tetraMesh}</object><object id="2" name="Assembly"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></components></object>`,
  build: '<item objectid="1"/><item objectid="2"/>',
});
save("materials", {
  resources: `<basematerials id="3"><base name="Orange" displaycolor="#FF8000FF"/><base name="Blue" displaycolor="#2040FFFF"/></basematerials><object id="1" name="Two materials" pid="3" pindex="0">${tetraMesh.replace('<triangle v1="1"', '<triangle p1="1" v1="1"')}</object>`,
});
save("vertex-colors", {
  resources: `<m:colorgroup id="3"><m:color color="#FF0000"/><m:color color="#00FF00"/><m:color color="#0000FF"/></m:colorgroup><object id="1" name="Vertex colors" pid="3" pindex="0">${tetraMesh.replaceAll("<triangle ", '<triangle p1="0" p2="1" p3="2" ')}</object>`,
});
save("texture", {
  resources: `<m:texture2d id="4" path="/3D/Textures/color.png" contenttype="image/png"/><m:texture2dgroup id="3" texid="4"><m:tex2coord u="0" v="0"/><m:tex2coord u="1" v="0"/><m:tex2coord u="0" v="1"/></m:texture2dgroup><object id="1" name="Embedded texture" pid="3" pindex="0">${tetraMesh.replaceAll("<triangle ", '<triangle p1="0" p2="1" p3="2" ')}</object>`,
  extra: {
    "3D/Textures/color.png": new Uint8Array(
      readFileSync("tests/fixtures/textures/1x1.png"),
    ),
    "3D/_rels/model.model.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="texture0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture" Target="/3D/Textures/color.png"/></Relationships>',
    ),
  },
});
writeFileSync(
  "tests/fixtures/broken/3mf/invalid-index.3mf",
  new Uint8Array(
    threeMfArchive({
      resources: `<object id="1">${tetraMesh.replace('v1="0"', 'v1="99"')}</object>`,
    }),
  ),
);
writeFileSync(
  "tests/fixtures/broken/3mf/cycle.3mf",
  new Uint8Array(
    threeMfArchive({
      resources:
        '<object id="1"><components><component objectid="1"/></components></object>',
    }),
  ),
);
writeFileSync(
  "tests/fixtures/broken/3mf/truncated.3mf",
  new Uint8Array(threeMfArchive()).slice(0, 100),
);
