import {
  Box3,
  BufferGeometry,
  Group,
  Material,
  MathUtils,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Texture,
  Vector3,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DisplayMode, SceneContext } from "./types";

export function getMaterials(material: Material | Material[]) {
  return Array.isArray(material) ? material : [material];
}

function disposeMaterialTextures(material: Material) {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) {
      value.dispose();
    }
  }
}

export function revokeUrls(urls: string[]) {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}

export function disposeObject(object: Group | Mesh | null) {
  if (!object) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      child.geometry.dispose();
    }

    if (child instanceof Mesh) {
      for (const material of getMaterials(child.material)) {
        if (!material) {
          continue;
        }

        disposeMaterialTextures(material);
        material.dispose();
      }
    }
  });
}

export function disposePreviewObject(object: Group | Mesh | null) {
  if (!object) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      child.geometry.dispose();
    }

    if (child instanceof Mesh) {
      for (const material of getMaterials(child.material)) {
        material.dispose();
      }
    }
  });
}

export function stopAnimations(context: SceneContext) {
  context.activeAction?.stop();
  context.mixer?.stopAllAction();
  context.activeAction = null;
  context.mixer = null;
  context.clips = [];
}

export function resetSceneObjects(context: SceneContext) {
  if (context.previewObject) {
    context.scene.remove(context.previewObject);
    disposePreviewObject(context.previewObject);
    context.previewObject = null;
  }

  if (context.sourceObject) {
    context.scene.remove(context.sourceObject);
    disposeObject(context.sourceObject);
    context.sourceObject = null;
  }

  context.mountedObject = null;
  context.textureRegistry = new Map<string, Texture>();
}

export function applyInitialView(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  object: Group | Mesh,
) {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const fitHeightDistance =
    maxDimension / (2 * Math.tan(MathUtils.degToRad(camera.fov * 0.5)));
  const fitDistance = fitHeightDistance * 1.5;
  const offset = new Vector3(1.15, 0.8, 1.15)
    .normalize()
    .multiplyScalar(fitDistance);

  camera.position.copy(center.clone().add(offset));
  camera.near = Math.max(maxDimension / 500, 0.01);
  camera.far = Math.max(maxDimension * 20, 200);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(maxDimension / 50, 0.05);
  controls.maxDistance = Math.max(maxDimension * 40, 50);
  controls.update();
}

export function getScaleWarning(object: Group | Mesh) {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);

  if (maxDimension <= 0.001) {
    return "Scale warning: the loaded content is extremely small.";
  }

  if (maxDimension >= 10000) {
    return "Scale warning: the loaded content is extremely large.";
  }

  return null;
}

export function applyDisplayMode(object: Group | Mesh, displayMode: DisplayMode) {
  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    for (const material of getMaterials(child.material)) {
      if (!("wireframe" in material)) {
        continue;
      }

      material.wireframe =
        displayMode === "wireframe" || displayMode === "texturedWireframe";

      if ("map" in material) {
        const originalMap =
          material.userData.originalMap ?? material.map ?? null;
        material.userData.originalMap = originalMap;
        material.map =
          displayMode === "untextured" || displayMode === "wireframe"
            ? null
            : originalMap;
      }

      material.needsUpdate = true;
    }
  });
}
