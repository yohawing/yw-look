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
  applyCameraPresetToMountedObject,
  findCameraBySelectionKey,
  frameCurrentMountedObject,
  syncActiveCameraSelection,
  syncPerspectiveCameraAspect,
} from "../camera";

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

describe("applyCameraPresetToMountedObject", () => {
  it("ignores empty contexts and non-asset surface modes", () => {
    expect(applyCameraPresetToMountedObject(null, "asset", "front")).toBe(
      false,
    );

    const object = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    expect(
      applyCameraPresetToMountedObject(
        createSceneContext(object),
        "texture",
        "front",
      ),
    ).toBe(false);
  });

  it("applies the preset to the mounted object", () => {
    const object = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    const context = createSceneContext(object);

    expect(applyCameraPresetToMountedObject(context, "asset", "front")).toBe(
      true,
    );
    expect(context.controls.enabled).toBe(true);
    expect(context.camera.position.z).toBeGreaterThan(0);
  });
});

describe("syncActiveCameraSelection", () => {
  it("activates a matching scene camera and syncs its aspect", () => {
    const object = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    const context = createSceneContext(object);
    const sceneCamera = new PerspectiveCamera(50, 1);
    sceneCamera.name = "Shot";
    context.scene.add(sceneCamera);

    expect(
      syncActiveCameraSelection(context, "Shot", {
        clientWidth: 1920,
        clientHeight: 1080,
      }),
    ).toBe(sceneCamera);
    expect(context.controls.enabled).toBe(false);
    expect(sceneCamera.aspect).toBeCloseTo(16 / 9);
  });

  it("falls back to free controls when the requested camera is missing", () => {
    const object = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    const context = createSceneContext(object);
    const warn = vi.fn();

    expect(
      syncActiveCameraSelection(context, "Missing", null, warn),
    ).toBeNull();
    expect(context.controls.enabled).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[viewer] USD camera "Missing" not found in scene graph — falling back to free camera',
    );
  });

  it("clears active camera selection", () => {
    const object = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    const context = createSceneContext(object);
    context.controls.enabled = false;

    expect(syncActiveCameraSelection(context, null, null)).toBeNull();
    expect(context.controls.enabled).toBe(true);
  });
});
