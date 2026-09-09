import { Mesh, Texture, TextureLoader, type Group } from "three";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { zipSync } from "three/examples/jsm/libs/fflate.module.js";
import { THREE_MF_LIMITS, unpackThreeMf } from "./threeMfArchive";
import { ThreeMfWorkerDOMParser, validateThreeMfModel } from "./threeMfXml";

export function textureDimensions(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    view.getUint32(12) === 0x49484452
  )
    return [view.getUint32(16), view.getUint32(20)];
  if (bytes.length > 4 && view.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker) &&
        length >= 8
      )
        return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  throw new Error("3MF: invalid PNG/JPEG texture header");
}

export async function parseThreeMf(buffer: ArrayBuffer): Promise<Group> {
  const files = unpackThreeMf(buffer);
  const metadata = validateThreeMfModel(files);
  const textureParts = Object.entries(files).filter(([name]) =>
    /^3D\/Textures?\//.test(name),
  );
  let pixels = 0;
  const pending: Promise<void>[] = [];
  const blobs = new Map<string, Blob>();
  const textures: Texture[] = [];
  const previousParser = globalThis.DOMParser;
  const previousLoad = TextureLoader.prototype.load;
  const previousCreateUrl = URL.createObjectURL;
  let object: Group | undefined;
  // ThreeMFLoader has a fixed DOM/TextureLoader dependency. Adapt these only during
  // its synchronous parse in this per-request worker, then restore immediately.
  // Keep embedded blobs in worker memory: termination must not leak blob URLs.
  globalThis.DOMParser = ThreeMfWorkerDOMParser as unknown as typeof DOMParser;
  URL.createObjectURL = (blob) => {
    if (!(blob instanceof Blob))
      throw new Error("3MF: invalid embedded texture");
    const token = `3mf-texture:${blobs.size}`;
    blobs.set(token, blob);
    return token;
  };
  TextureLoader.prototype.load = function (url, onLoad) {
    const blob = blobs.get(url);
    if (!blob) throw new Error("3MF: external texture access is forbidden");
    const texture = new Texture<ImageData>();
    texture.userData.textureSourceKind = "embedded";
    const loaderTexture = texture as unknown as ReturnType<
      TextureLoader["load"]
    >;
    textures.push(texture);
    pending.push(
      (async () => {
        const data = new Uint8Array(await blob.arrayBuffer());
        const [width, height] = textureDimensions(data);
        pixels += width * height;
        if (
          !width ||
          !height ||
          width > 8192 ||
          height > 8192 ||
          pixels > THREE_MF_LIMITS.texturePixels
        )
          throw new Error("3MF: decoded texture pixel limit exceeded");
        texture.name =
          textureParts.find(
            ([, bytes]) =>
              bytes.length === data.length &&
              bytes.every((byte, index) => byte === data[index]),
          )?.[0] ?? "Embedded 3MF texture";
        const bitmap = await createImageBitmap(new Blob([data]), {
          imageOrientation: "none",
        });
        try {
          if (bitmap.width !== width || bitmap.height !== height)
            throw new Error("3MF: texture dimensions disagree with header");
          const canvas = new OffscreenCanvas(width, height);
          const context = canvas.getContext("2d");
          if (!context)
            throw new Error("3MF: worker image decoder is unavailable");
          context.drawImage(bitmap, 0, 0);
          texture.image = context.getImageData(0, 0, width, height);
          texture.needsUpdate = true;
          onLoad?.(loaderTexture);
        } finally {
          bitmap.close();
        }
      })(),
    );
    return loaderTexture;
  };
  try {
    try {
      // Repackage validated bytes without compression; the loader cannot inflate
      // unvalidated input or follow non-canonical package relationships.
      const validated = zipSync(files, { level: 0 });
      object = new ThreeMFLoader().parse(validated.buffer as ArrayBuffer);
    } finally {
      globalThis.DOMParser = previousParser;
      TextureLoader.prototype.load = previousLoad;
      URL.createObjectURL = previousCreateUrl;
    }
    await Promise.all(pending);
    object.rotation.x = -Math.PI / 2;
    object.scale.setScalar(metadata.metersPerUnit);
    object.userData.threeMf = metadata;
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (
        child.matrixWorld.elements.some(
          (value) => !Number.isFinite(value) || Math.abs(value) > 1e12,
        )
      )
        throw new Error("3MF: composed transform exceeds numeric limits");
      if (!(child instanceof Mesh)) return;
      if (!child.geometry.attributes.normal)
        child.geometry.computeVertexNormals();
      for (const material of Array.isArray(child.material)
        ? child.material
        : [child.material]) {
        if (material.opacity < 1) material.transparent = true;
      }
    });
    return object;
  } catch (error) {
    await Promise.allSettled(pending);
    object?.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      for (const material of Array.isArray(child.material)
        ? child.material
        : [child.material])
        material.dispose();
    });
    textures.forEach((texture) => texture.dispose());
    throw error;
  } finally {
    blobs.clear();
  }
}
