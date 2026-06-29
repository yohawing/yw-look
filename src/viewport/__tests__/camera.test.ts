import { describe, expect, it, vi } from "vitest";
import { OrthographicCamera, PerspectiveCamera, Scene } from "three";
import {
  findCameraBySelectionKey,
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
