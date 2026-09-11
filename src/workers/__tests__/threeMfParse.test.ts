// @vitest-environment node
import { Box3, Mesh, MeshPhongMaterial, TextureLoader } from "three";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";
import { parseThreeMf, textureDimensions } from "../threeMfParse";
import { validateThreeMfModel } from "../threeMfXml";
import { createStaticSceneObject, toStaticScenePayload } from "../staticScene";
import { tetraMesh, threeMfArchive, threeMfFiles } from "./threeMfFixtures";

describe("3MF preview", () => {
  it("rejects oversized embedded pixels without creating native blob URLs and restores adapters", async () => {
    const { unpackThreeMf } = await import("../threeMfArchive");
    const source = readFileSync("tests/fixtures/models/3mf/texture.3mf");
    const files = unpackThreeMf(
      source.buffer.slice(
        source.byteOffset,
        source.byteOffset + source.byteLength,
      ),
    );
    new DataView(files["3D/Textures/color.png"].buffer).setUint32(16, 9000);
    const nativeUrl = vi.spyOn(URL, "createObjectURL");
    const previousLoad = TextureLoader.prototype.load;
    try {
      await expect(
        parseThreeMf(zipSync(files).slice().buffer as ArrayBuffer),
      ).rejects.toThrow(/pixel limit/);
      expect(nativeUrl).not.toHaveBeenCalled();
      expect(URL.createObjectURL).toBe(nativeUrl);
      expect(TextureLoader.prototype.load).toBe(previousLoad);
    } finally {
      nativeUrl.mockRestore();
    }
  });
  it("rejects singular and excessive composed transforms", async () => {
    await expect(
      parseThreeMf(
        threeMfArchive({
          build: '<item objectid="1" transform="0 0 0 0 0 0 0 0 0 0 0 0"/>',
        }),
      ),
    ).rejects.toThrow(/singular/);
    await expect(
      parseThreeMf(
        threeMfArchive({
          resources: `<object id="1">${tetraMesh}</object><object id="2"><components><component objectid="1" transform="1000000000 0 0 0 1000000000 0 0 0 1000000000 0 0 0"/></components></object>`,
          build:
            '<item objectid="2" transform="1000000000 0 0 0 1000000000 0 0 0 1000000000 0 0 0"/>',
        }),
      ),
    ).rejects.toThrow(/numeric limits/);
  });
  it.each([
    ["millimeter", 0.001],
    ["centimeter", 0.01],
    ["meter", 1],
    ["inch", 0.0254],
    ["foot", 0.3048],
    ["micron", 0.000001],
  ] as const)(
    "preserves %s units and Z-up orientation",
    async (unit, scale) => {
      const object = await parseThreeMf(threeMfArchive({ unit }));
      const bounds = new Box3().setFromObject(object);
      expect(bounds.max.x).toBeCloseTo(10 * scale, 7);
      expect(bounds.max.y).toBeCloseTo(10 * scale, 7);
      expect(bounds.min.z).toBeCloseTo(-10 * scale, 7);
      expect(object.userData.threeMf.unit).toBe(unit);
    },
  );
  it("preserves component instances, build transforms, names, and hierarchy through worker transfer", async () => {
    const object = await parseThreeMf(
      threeMfArchive({
        resources: `<object id="1" name="Part">${tetraMesh}</object><object id="2" name="Assembly"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></components></object>`,
        build: `<item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 20 0"/>`,
      }),
    );
    const payload = toStaticScenePayload(object, true, {
      requireSerializableTextures: true,
    });
    expect(payload?.root?.children).toHaveLength(2);
    const restored = createStaticSceneObject(payload!);
    const box = new Box3().setFromObject(restored);
    expect(box.max.x).toBeCloseTo(0.03);
    expect(box.min.z).toBeCloseTo(-0.03);
    expect(restored.getObjectByName("Assembly")).toBeDefined();
  });
  it("normalizes XML whitespace in component and build transforms", async () => {
    const object = await parseThreeMf(
      threeMfArchive({
        resources: `<object id="1">${tetraMesh}</object><object id="2"><components><component objectid="1" transform=" 1  0\t0 0 1 0 0 0 1 20 0 0 "/></components></object>`,
        build: '<item objectid="2" transform="\n1 0 0 0 1 0 0 0 1 0  20 0 "/>',
      }),
    );
    const box = new Box3().setFromObject(object);
    expect(box.max.x).toBeCloseTo(0.03);
    expect(box.min.z).toBeCloseTo(-0.03);
    object.traverse((node) =>
      expect(node.matrixWorld.elements.every(Number.isFinite)).toBe(true),
    );
  });
  it("retains authored vertex colors and flat shading across worker transfer", async () => {
    const object = await parseThreeMf(
      threeMfArchive({
        resources: `<m:colorgroup id="3"><m:color color="#FF0000"/><m:color color="#00FF00"/><m:color color="#0000FF"/></m:colorgroup><object id="1" pid="3" pindex="0">${tetraMesh.replaceAll("<triangle ", '<triangle p1="0" p2="1" p3="2" ')}</object>`,
      }),
    );
    const restored = createStaticSceneObject(
      toStaticScenePayload(object, true)!,
    );
    const meshes: Mesh[] = [];
    restored.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    expect(meshes).toHaveLength(1);
    const material = meshes[0].material as MeshPhongMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.flatShading).toBe(true);
    expect(
      Array.from(meshes[0].geometry.attributes.color.array).slice(0, 9),
    ).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it("preserves named base materials", async () => {
    const object = await parseThreeMf(
      threeMfArchive({
        resources: `<basematerials id="3"><base name="Orange" displaycolor="#FF8000FF"/></basematerials><object id="1" pid="3" pindex="0">${tetraMesh}</object>`,
      }),
    );
    let name = "";
    object.traverse((node) => {
      if (node instanceof Mesh)
        name = (node.material as MeshPhongMaterial).name;
    });
    expect(name).toBe("Orange");
  });
  it("reports unsupported optional elements and restores the loader adapter after rejection", async () => {
    const files = threeMfFiles({ attributes: 'xmlns:x="urn:unknown"' });
    files["3D/model.model"] = strToU8(
      new TextDecoder()
        .decode(files["3D/model.model"])
        .replace("<resources>", "<x:feature/><resources>"),
    );
    const parsed = await parseThreeMf(
      zipSync(files).slice().buffer as ArrayBuffer,
    );
    expect(parsed.userData.threeMf.warnings).toContain(
      "3MF: unsupported element x:feature",
    );
    const previous = TextureLoader.prototype.load;
    await expect(
      parseThreeMf(
        threeMfArchive({
          attributes: 'xmlns:x="urn:unknown" requiredextensions="x"',
        }),
      ),
    ).rejects.toThrow(/required extension/);
    expect(TextureLoader.prototype.load).toBe(previous);
  });
  it.each([
    [
      "cycle",
      `<object id="1"><components><component objectid="1"/></components></object>`,
      /cyclic/,
    ],
    [
      "missing object",
      `<object id="1"><components><component objectid="2"/></components></object>`,
      /missing/,
    ],
    [
      "duplicate id",
      `<object id="1">${tetraMesh}</object><object id="1">${tetraMesh}</object>`,
      /duplicate/,
    ],
    [
      "invalid index",
      `<object id="1">${tetraMesh.replace('v1="0"', 'v1="999"')}</object>`,
      /triangle index/,
    ],
    [
      "invalid coordinate",
      `<object id="1">${tetraMesh.replace('x="0"', 'x="NaN"')}</object>`,
      /coordinate/,
    ],
  ] as const)("rejects %s", async (_name, resources, message) => {
    await expect(parseThreeMf(threeMfArchive({ resources }))).rejects.toThrow(
      message,
    );
  });
  it("rejects instance amplification before building meshes", () => {
    let resources = `<object id="1">${tetraMesh}</object>`;
    for (let id = 2; id < 17; id++)
      resources += `<object id="${id}"><components><component objectid="${id - 1}"/><component objectid="${id - 1}"/></components></object>`;
    expect(() =>
      validateThreeMfModel(
        threeMfFiles({ resources, build: '<item objectid="16"/>' }),
      ),
    ).toThrow(/limit/);
  });
  it("rejects deep component chains even when children were already validated", () => {
    let resources = `<object id="1">${tetraMesh}</object>`;
    for (let id = 2; id <= 66; id++)
      resources += `<object id="${id}"><components><component objectid="${id - 1}"/></components></object>`;
    expect(() =>
      validateThreeMfModel(
        threeMfFiles({ resources, build: '<item objectid="66"/>' }),
      ),
    ).toThrow(/limit|nested/);
  });
  it("rejects malformed XML, DTDs, and external relationships", () => {
    for (const source of [
      "<model><resources></model>",
      '<!DOCTYPE model [<!ENTITY x "x">]><model/>',
    ]) {
      const files = threeMfFiles();
      files["3D/model.model"] = strToU8(source);
      expect(() => validateThreeMfModel(files)).toThrow();
    }
    const files = threeMfFiles();
    files["_rels/.rels"] = strToU8(
      '<Relationships><Relationship Id="x" Type="model" Target="https://example.org/model" TargetMode="External"/></Relationships>',
    );
    expect(() => validateThreeMfModel(files)).toThrow(/external/);
  });
  it("reads PNG dimensions before allocating decoded pixels", () => {
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x89504e47);
    view.setUint32(4, 0x0d0a1a0a);
    view.setUint32(12, 0x49484452);
    view.setUint32(16, 4000);
    view.setUint32(20, 2000);
    expect(textureDimensions(bytes)).toEqual([4000, 2000]);
    expect(() => textureDimensions(new Uint8Array(24))).toThrow(/header/);
  });
});
