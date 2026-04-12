import {
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  Box3,
  BufferGeometry,
  Color,
  CompressedTexture,
  DataTexture,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
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
      // Phase 5d L3: stash animation clips on the scene's userData so
      // `runSingleModelMode` can spin up an AnimationMixer if any
      // animations are present. The preview-model skill captures one
      // frame at t=0, but the mixer tick lets a future caller advance
      // it before grabbing the screenshot.
      if (gltf.animations && gltf.animations.length > 0) {
        gltf.scene.userData.animations = gltf.animations;
      }
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

async function runSingleModelMode(rawPath: string) {
  const normalizedPath = rawPath.replace(/^\/+/, "");
  const format = normalizedPath.split(".").pop()?.toLowerCase() ?? "";
  const sample: SampleCase = {
    id: "preview",
    kind: "model",
    format,
    path: normalizedPath,
  };

  const canvas = document.createElement("canvas");
  canvas.id = "preview-canvas";
  canvas.width = 1024;
  canvas.height = 768;
  canvas.style.cssText = "display:block;width:1024px;height:768px;";
  document.body.appendChild(canvas);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(1024, 768, false);
  renderer.setClearColor(new Color("#1a1c22"));

  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 0.6));
  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.45);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const camera = new PerspectiveCamera(45, 1024 / 768, 0.01, 5000);

  try {
    const object = (await loadCase(sample)) as Group | Mesh;
    scene.add(object);

    const bbox = new Box3().setFromObject(object);
    const size = bbox.getSize(new Vector3());
    const center = bbox.getCenter(new Vector3());
    const radius = Math.max(size.x, size.y, size.z) || 1;
    camera.position
      .copy(center)
      .add(new Vector3(radius * 1.6, radius * 1.2, radius * 1.8));
    camera.lookAt(center);
    camera.near = Math.max(radius / 1000, 0.001);
    camera.far = radius * 100;
    camera.updateProjectionMatrix();

    // Phase 5d L3: if the loaded glTF carried any animation clips,
    // run them through an AnimationMixer for ~16 ticks (~ 1/4 second
    // of playback) before grabbing the final frame so the captured
    // screenshot reflects mid-animation deformation rather than the
    // bind pose. Skipped silently for non-animated glTF / FBX / etc.
    const animations = ((object as Object3D).userData?.animations ??
      []) as AnimationClip[];
    let animationFrames = 0;
    if (animations.length > 0) {
      const mixer = new AnimationMixer(object as Object3D);
      for (const clip of animations) {
        mixer.clipAction(clip).play();
      }
      const dt = 1 / 60;
      for (let i = 0; i < 16; i++) {
        mixer.update(dt);
        animationFrames += 1;
      }
    }

    renderer.render(scene, camera);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    renderer.render(scene, camera);

    setOutput({
      mode: "single",
      ok: true,
      format,
      path: rawPath,
      animationClips: animations.length,
      animationFrames,
      bbox: {
        min: bbox.min.toArray(),
        max: bbox.max.toArray(),
        size: size.toArray(),
        sizeMax: radius,
      },
    });
  } catch (error) {
    console.error("[preview] load failed:", error);
    setOutput({
      mode: "single",
      ok: false,
      format,
      path: rawPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const params = new URLSearchParams(location.search);
const singlePath = params.get("path");

if (singlePath) {
  runSingleModelMode(singlePath).catch((error) => {
    setOutput({
      mode: "single",
      fatal: error instanceof Error ? error.message : String(error),
    });
  });
} else {
  main().catch((error) => {
    setOutput({
      fatal: error instanceof Error ? error.message : String(error),
    });
  });
}
