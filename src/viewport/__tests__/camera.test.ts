import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneContext } from "../../types/viewer";
import {
  findCameraBySelectionKey,
  frameCurrentMountedObject,
  syncPerspectiveCameraAspect,
} from "../camera";

describe("findCameraBySelectionKey", () => {
  it("finds cameras by stable duplicate-name selection keys", () => {
    const scene = new Scene();
    const first = new PerspectiveCamera();
    const second = new PerspectiveCamera();
    first.name = "Shot";
    second.name = "Shot";
    scene.add(first, second);

    expect(findCameraBySelectionKey(scene, "Shot")).toBe(first);
    expect(findCameraBySelectionKey(scene, "Shot#1")).toBe(second);
    expect(findCameraBySelectionKey(scene, "Missing")).toBeNull();
  });
});

describe("syncPerspectiveCameraAspect", () => {
  it("updates perspective cameras from the host aspect ratio", () => {
    const camera = new PerspectiveCamera(50, 1);
    const updateProjectionMatrix = vi.spyOn(camera, "updateProjectionMatrix");

    expect(
      syncPerspectiveCameraAspect(camera, {
        clientWidth: 1920,
        clientHeight: 1080,
      }),
    ).toBe(true);
    expect(camera.aspect).toBeCloseTo(16 / 9);
    expect(updateProjectionMatrix).toHaveBeenCalledTimes(1);
  });

  it("ignores orthographic cameras and empty hosts", () => {
    const camera = new OrthographicCamera();
    const updateProjectionMatrix = vi.spyOn(camera, "updateProjectionMatrix");

    expect(
      syncPerspectiveCameraAspect(camera, {
        clientWidth: 1920,
        clientHeight: 1080,
      }),
    ).toBe(false);
    expect(syncPerspectiveCameraAspect(new PerspectiveCamera(), null)).toBe(
      false,
    );
    expect(
      syncPerspectiveCameraAspect(new PerspectiveCamera(), {
        clientWidth: 0,
        clientHeight: 1080,
      }),
    ).toBe(false);
    expect(updateProjectionMatrix).not.toHaveBeenCalled();
  });
});

describe("frameCurrentMountedObject", () => {
  function createSceneContext(mountedObject: SceneContext["mountedObject"]) {
    const scene = new Scene();
    const camera = new PerspectiveCamera(50, 1);
    const controls = new OrbitControls(camera, document.createElement("div"));
    if (mountedObject) {
      scene.add(mountedObject);
    }

    return {
      renderer: {},
      scene,
      camera,
      controls,
      pmremGenerator: {},
      mountedObject,
      sourceObject: mountedObject,
      previewObject: null,
      boneOnlyPreview: false,
      cleanupUrls: [],
      cleanupCallbacks: [],
      animationRoot: null,
      mixer: null,
      clips: [],
      activeAction: null,
      mmdModel: null,
      mmdMotion: null,
      textureRegistry: new Map(),
      rawMaxDimension: 3,
    } as unknown as SceneContext;
  }

  it("ignores empty contexts", () => {
    expect(frameCurrentMountedObject(null, "asset", true, true, 1, false)).toBe(
      false,
    );
    expect(
      frameCurrentMountedObject(
        createSceneContext(null),
        "asset",
        true,
        true,
        1,
        false,
      ),
    ).toBe(false);
  });

  it("frames the mounted object", () => {
    const object = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    const context = createSceneContext(object);

    expect(
      frameCurrentMountedObject(context, "asset", true, true, 1.5, false),
    ).toBe(true);
    expect(context.controls.enabled).toBe(true);
    expect(context.camera.far).toBeGreaterThan(100);
    expect(context.camera.position.length()).toBeGreaterThan(0);
  });
});
