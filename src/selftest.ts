import {
  BufferGeometry,
  CompressedTexture,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";

type SampleCase = {
  id: string;
  kind: "model" | "texture";
  format: string;
  path: string;
};

type Manifest = {
  cases: SampleCase[];
};

type CaseResult = {
  id: string;
  format: string;
  path: string;
  ok: boolean;
  detail: string;
};

const output = document.getElementById("output");

function setOutput(value: unknown) {
  if (output) {
    output.textContent =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
}

function createTexturePreview(
  texture: Texture | DataTexture | CompressedTexture,
) {
  const image = "image" in texture ? texture.image : null;
  const imageWithSize = image as { width?: number; height?: number } | null;
  const widthValue =
    imageWithSize && typeof imageWithSize.width === "number"
      ? imageWithSize.width
      : 1;
  const heightValue =
    imageWithSize && typeof imageWithSize.height === "number"
      ? imageWithSize.height
      : 1;
  const ratio = widthValue / heightValue || 1;
  const width = ratio >= 1 ? 2.2 : 2.2 * ratio;
  const height = ratio >= 1 ? 2.2 / ratio : 2.2;

  return new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
}

function disposeObject(object: Group | Mesh | null) {
  if (!object) {
    return;
  }

  object.traverse((child) => {
    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      child.geometry.dispose();
    }

    if (child instanceof Mesh) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      for (const material of materials) {
        if (!material) {
          continue;
        }

        if ("map" in material && material.map) {
          (material.map as Texture).dispose();
        }

        material.dispose();
      }
    }
  });
}

async function readArrayBuffer(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.arrayBuffer();
}

async function loadCase(sample: SampleCase) {
  const url = `/${sample.path.replace(/\\/g, "/")}`;
  const directoryUrl = url.slice(0, url.lastIndexOf("/") + 1);

  switch (sample.format) {
    case "glb": {
      const { GLTFLoader } =
        await import("three/examples/jsm/loaders/GLTFLoader.js");
      const buffer = await readArrayBuffer(url);
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      return gltf.scene;
    }
    case "gltf": {
      const { GLTFLoader } =
        await import("three/examples/jsm/loaders/GLTFLoader.js");
      const buffer = await readArrayBuffer(url);
      const text = new TextDecoder().decode(buffer);
      const gltf = await new GLTFLoader().parseAsync(text, directoryUrl);
      return gltf.scene;
    }
    case "fbx": {
      const { FBXLoader } =
        await import("three/examples/jsm/loaders/FBXLoader.js");
      return new FBXLoader().loadAsync(url);
    }
    case "obj": {
      const { OBJLoader } =
        await import("three/examples/jsm/loaders/OBJLoader.js");
      return new OBJLoader().loadAsync(url);
    }
    case "ply": {
      const { PLYLoader } =
        await import("three/examples/jsm/loaders/PLYLoader.js");
      const buffer = await readArrayBuffer(url);
      const geometry = new PLYLoader().parse(buffer);
      geometry.computeVertexNormals();
      return new Mesh(
        geometry,
        new MeshStandardMaterial({ color: "#c7d2e3", roughness: 0.72 }),
      );
    }
    case "stl": {
      const { STLLoader } =
        await import("three/examples/jsm/loaders/STLLoader.js");
      const buffer = await readArrayBuffer(url);
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      return new Mesh(
        geometry,
        new MeshStandardMaterial({ color: "#d7dde8", roughness: 0.68 }),
      );
    }
    case "png":
    case "jpg":
    case "jpeg": {
      const texture = await new TextureLoader().loadAsync(url);
      texture.colorSpace = SRGBColorSpace;
      return createTexturePreview(texture);
    }
    case "tga": {
      const { TGALoader } =
        await import("three/examples/jsm/loaders/TGALoader.js");
      const texture = await new TGALoader().loadAsync(url);
      texture.colorSpace = SRGBColorSpace;
      return createTexturePreview(texture);
    }
    case "dds": {
      const { DDSLoader } =
        await import("three/examples/jsm/loaders/DDSLoader.js");
      const texture = await new DDSLoader().loadAsync(url);
      texture.colorSpace = SRGBColorSpace;
      return createTexturePreview(texture);
    }
    case "hdr": {
      const { RGBELoader } =
        await import("three/examples/jsm/loaders/RGBELoader.js");
      const texture = await new RGBELoader().loadAsync(url);
      return createTexturePreview(texture);
    }
    case "exr": {
      const { EXRLoader } =
        await import("three/examples/jsm/loaders/EXRLoader.js");
      const texture = await new EXRLoader().loadAsync(url);
      return createTexturePreview(texture);
    }
    default:
      throw new Error(`Unsupported format in selftest: ${sample.format}`);
  }
}

async function main() {
  const manifestResponse = await fetch("/samples/manifest.json");
  const manifest = (await manifestResponse.json()) as Manifest;
  const supportedCases = manifest.cases.filter((sample) =>
    [
      "glb",
      "gltf",
      "fbx",
      "obj",
      "ply",
      "stl",
      "png",
      "jpg",
      "jpeg",
      "tga",
      "dds",
      "hdr",
      "exr",
    ].includes(sample.format),
  );

  const results: CaseResult[] = [];

  for (const sample of supportedCases) {
    try {
      const object = await loadCase(sample);
      disposeObject(object as Group | Mesh);
      results.push({
        id: sample.id,
        format: sample.format,
        path: sample.path,
        ok: true,
        detail: "loaded",
      });
    } catch (error: unknown) {
      results.push({
        id: sample.id,
        format: sample.format,
        path: sample.path,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    setOutput(results);
  }

  const failed = results.filter((result) => !result.ok);
  setOutput({ failedCount: failed.length, results });
}

main().catch((error) => {
  setOutput({
    fatal: error instanceof Error ? error.message : String(error),
  });
});
