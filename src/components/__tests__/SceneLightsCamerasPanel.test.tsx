import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SceneLightsCamerasPanel } from "../SceneLightsCamerasPanel";
import { useViewerStore } from "../../stores/viewerStore";
import type { CameraEntry } from "../../types/viewer";

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
  useViewerStore.setState({
    activeCameraId: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("SceneLightsCamerasPanel", () => {
  it("selects a scene camera through the viewer store", () => {
    const { getByRole } = render(
      <SceneLightsCamerasPanel lights={[]} cameras={[camera]} />,
    );

    fireEvent.click(getByRole("button", { name: "View" }));

    expect(useViewerStore.getState().activeCameraId).toBe("cam-1");
  });

  it("clears the active camera when the active camera button is clicked", () => {
    useViewerStore.setState({
      activeCameraId: "cam-1",
    });
    const { getByRole } = render(
      <SceneLightsCamerasPanel lights={[]} cameras={[camera]} />,
    );

    fireEvent.click(getByRole("button", { name: "Active" }));

    expect(useViewerStore.getState().activeCameraId).toBeNull();
  });
});
