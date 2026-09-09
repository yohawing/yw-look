import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";

export const tetraMesh = `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="2" v2="0" v3="3"/></triangles></mesh>`;
export function threeMfFiles({
  resources = `<object id="1" name="Tetrahedron" type="model">${tetraMesh}</object>`,
  build = `<item objectid="1"/>`,
  unit = "millimeter",
  attributes = "",
  extra = {},
}: {
  resources?: string;
  build?: string;
  unit?: string;
  attributes?: string;
  extra?: Record<string, Uint8Array>;
} = {}) {
  return {
    "[Content_Types].xml": strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/model.model"/></Relationships>`,
    ),
    "3D/model.model": strToU8(
      `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" unit="${unit}" ${attributes}><resources>${resources}</resources><build>${build}</build></model>`,
    ),
    ...extra,
  };
}
export function threeMfArchive(
  options: Parameters<typeof threeMfFiles>[0] = {},
) {
  return zipSync(threeMfFiles(options), { mtime: new Date(2020, 0, 1) }).slice()
    .buffer as ArrayBuffer;
}
