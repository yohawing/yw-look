import { readFile } from "node:fs/promises";
import path from "node:path";
import { Color, MeshPhysicalMaterial } from "three";
import { describe, expect, it } from "vitest";
import rhino3dm from "rhino3dm";

type MeshLike = {
  vertices(): { count: number };
  faces(): { triangleCount: number };
  vertexColors(): { count: number };
  textureCoordinates(): { count: number };
};

type InstanceReferenceLike = {
  parentIdefId: string;
};

const FIXTURE_CASES = [
  {
    label: "generic Rhino archive",
    fileName: "rhino3dm-mesh-material-instance.3dm",
    archiveVersion: 80,
  },
  {
    label: "Rhino 7 archive",
    fileName: "rhino3dm-v7-mesh-material-instance.3dm",
    archiveVersion: 70,
  },
  {
    label: "Rhino 8 archive",
    fileName: "rhino3dm-v8-mesh-material-instance.3dm",
    archiveVersion: 80,
  },
] as const;

for (const fixtureCase of FIXTURE_CASES) {
  describe(`generated ${fixtureCase.label}`, () => {
    it("round-trips through the rhino3dm WASM API with visible mesh data", async () => {
      const bytes = await readFile(
        path.resolve(
          process.cwd(),
          "tests/fixtures/models",
          fixtureCase.fileName,
        ),
      );
      const rhino = await rhino3dm();
      const model = rhino.File3dm.fromByteArray(bytes);
      const objects = model.objects();
      const main = objects.get(0);
      const mainMesh = main.geometry() as unknown as MeshLike;
      const mainAttributes = main.attributes();
      const instance = objects
        .get(objects.count - 1)
        .geometry() as unknown as InstanceReferenceLike;
      const material = model.materials().get(0);
      const diffuseColor = material.diffuseColor as unknown as {
        r: number;
        g: number;
        b: number;
      };

      expect(model.archiveVersion).toBe(fixtureCase.archiveVersion);
      expect(model.layers().count).toBe(2);
      expect(model.materials().count).toBe(1);
      expect(model.instanceDefinitions().count).toBe(1);
      expect(objects.count).toBe(3);
      expect(mainAttributes.name).toBe("3DM Fixture Main Mesh");
      expect(mainAttributes.layerIndex).toBe(0);
      expect(mainAttributes.materialIndex).toBe(0);
      expect(mainAttributes.materialSource.constructor.name).toBe(
        "ObjectMaterialSource_MaterialFromObject",
      );
      expect(mainMesh.vertices().count).toBe(3);
      expect(mainMesh.faces().triangleCount).toBe(1);
      expect(mainMesh.vertexColors().count).toBe(3);
      expect(mainMesh.textureCoordinates().count).toBe(3);
      expect(diffuseColor).toEqual({ r: 36, g: 132, b: 220, a: 255 });

      // This mirrors Rhino3dmLoader._createMaterial's diffuse-color mapping:
      // Rhino's 0..255 color is passed to Three in linear 0..1 space.
      const threeMaterial = new MeshPhysicalMaterial({
        name: material.name,
        color: new Color(
          diffuseColor.r / 255,
          diffuseColor.g / 255,
          diffuseColor.b / 255,
        ),
      });
      expect(threeMaterial.name).toBe("3DM Fixture Blue");
      expect(threeMaterial.color.getHexString()).toBe("69beef");
      threeMaterial.dispose();
      expect(instance.parentIdefId).toBe(model.instanceDefinitions().get(0).id);
    });
  });
}
