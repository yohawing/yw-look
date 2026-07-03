import { Material, Mesh, Texture, type Object3D } from "three";

function isTexture(value: unknown): value is Texture {
  return (
    typeof value === "object" &&
    value !== null &&
    "isTexture" in value &&
    value.isTexture === true
  );
}

function collectMaterialTextures(material: Material): Texture[] {
  const textures = new Set<Texture>();
  for (const value of Object.values(material) as unknown[]) {
    if (isTexture(value)) {
      textures.add(value);
    }
  }
  return [...textures];
}

function collectObjectTextures(object: Object3D): Texture[] {
  const textures = new Set<Texture>();
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      for (const texture of collectMaterialTextures(material)) {
        textures.add(texture);
      }
    }
  });
  return [...textures];
}

function isImageBitmapValue(value: unknown): value is ImageBitmap {
  return (
    typeof ImageBitmap !== "undefined" &&
    value instanceof ImageBitmap &&
    typeof value.width === "number" &&
    typeof value.height === "number"
  );
}

async function imageBitmapToImageData(image: ImageBitmap): Promise<ImageData> {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is unavailable for worker texture export");
  }
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(
      "2D canvas context is unavailable for worker texture export",
    );
  }
  context.drawImage(image, 0, 0, image.width, image.height);
  return context.getImageData(0, 0, image.width, image.height);
}

function detachTextureFromMaterials(object: Object3D, texture: Texture): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      const materialRecord = material as unknown as Record<string, unknown>;
      for (const key of Object.keys(materialRecord)) {
        if (materialRecord[key] === texture) {
          materialRecord[key] = null;
        }
      }
    }
  });
}

export async function bakeImageBitmapTextures(object: Object3D): Promise<void> {
  await Promise.all(
    collectObjectTextures(object).map(async (texture) => {
      const image = texture.image;
      if (!isImageBitmapValue(image)) return;
      try {
        texture.image = await imageBitmapToImageData(image);
      } catch {
        detachTextureFromMaterials(object, texture);
        texture.image = null;
      } finally {
        image.close();
      }
    }),
  );
}
