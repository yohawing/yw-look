import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SceneLightsCamerasPanel } from "../SceneLightsCamerasPanel";
import { useFileStore } from "../../stores/fileStore";
import { useViewerStore } from "../../stores/viewerStore";
import type {
  AssetMetadata,
  CameraEntry,
  LightEntry,
} from "../../types/viewer";

const camera: CameraEntry = {
  id: "cam-1",
  name: "ShotCam",
  projection: "perspective",
  fov: 45,
  aspect: 1.778,
  near: 0.1,
  far: 1000,
};

beforeEach(() => {
  useFileStore.setState({
    currentFile: null,
    directoryListing: null,
    assetInspection: null,
    assetMetadata: null,
    packFileRequest: null,
    openError: null,
  });
  useViewerStore.setState({
    activeCameraId: null,
  });
});

afterEach(() => {
  cleanup();
});

function makeMetadata({
  cameras = [],
  lights = [],
}: {
  cameras?: CameraEntry[];
  lights?: LightEntry[];
}): AssetMetadata {
  return {
    formatLabel: "Test",
    formatVersion: null,
    nodeCount: 0,
    meshCount: 0,
    materialCount: 0,
    textureCount: 0,
    hasAnimation: false,
    hierarchy: [],
    textures: [],
    materials: [],
    lights,
    cameras,
    objectInfo: {},
  };
}

function renderWithSceneMetadata(assetMetadata: AssetMetadata) {
  useFileStore.setState({ assetMetadata });
  return render(<SceneLightsCamerasPanel />);
}

describe("SceneLightsCamerasPanel", () => {
  it("selects a scene camera through the viewer store", () => {
    const { getByRole } = renderWithSceneMetadata(
      makeMetadata({ cameras: [camera] }),
    );

    fireEvent.click(getByRole("button", { name: "View" }));

    expect(useViewerStore.getState().activeCameraId).toBe("cam-1");
  });

  it("clears the active camera when the active camera button is clicked", () => {
    useViewerStore.setState({
      activeCameraId: "cam-1",
    });
    const { getByRole } = renderWithSceneMetadata(
      makeMetadata({ cameras: [camera] }),
    );

    fireEvent.click(getByRole("button", { name: "Active" }));

    expect(useViewerStore.getState().activeCameraId).toBeNull();
  });
});
