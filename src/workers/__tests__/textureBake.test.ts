import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  ObjectLoader,
  Texture,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bakeImageBitmapTextures } from "../textureBake";

class FakeImageBitmap {
  readonly width = 1;
  readonly height = 1;
  readonly close = vi.fn();
}

function makeTexturedObject() {
  const image = new FakeImageBitmap();
  const texture = new Texture(image as unknown as ImageBitmap);
  const material = new MeshBasicMaterial({ map: texture });
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  const group = new Group();
  group.add(mesh);
  return { group, image, material, texture };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bakeImageBitmapTextures", () => {
  it("drops texture slots and keeps ObjectLoader roundtrip valid when baking is unsupported", async () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    vi.stubGlobal("OffscreenCanvas", undefined);
    const { group, image, material, texture } = makeTexturedObject();

    await bakeImageBitmapTextures(group);

    expect(material.map).toBeNull();
    expect(texture.image).toBeNull();
    expect(image.close).toHaveBeenCalledOnce();

    const parsed = new ObjectLoader().parse(group.toJSON());
    expect(parsed.children).toHaveLength(1);
  });

  it("keeps texture slots when an ImageBitmap can be baked into ImageData", async () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const imageData = {
      data: new Uint8ClampedArray([255, 255, 255, 255]),
      height: 1,
      width: 1,
    } as ImageData;
    const drawImage = vi.fn();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return {
            drawImage,
            getImageData: () => imageData,
          };
        }
      },
    );
    const { group, image, material, texture } = makeTexturedObject();

    await bakeImageBitmapTextures(group);

    expect(material.map).toBe(texture);
    expect(texture.image).toBe(imageData);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(image.close).toHaveBeenCalledOnce();
  });
});
