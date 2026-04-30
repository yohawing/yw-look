/**
 * Tests for the USD camera switcher UI in SceneLightsCamerasCard (#34).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SceneLightsCamerasCard } from "../SceneLightsCamerasCard";
import type { CameraEntry, LightEntry } from "../assetMetadata";

const cameras: CameraEntry[] = [
  {
    id: "cam-1",
    name: "ShotCam",
    projection: "perspective",
    fov: 45,
    aspect: 1.778,
    near: 0.1,
    far: 1000,
  },
  {
    id: "cam-2",
    name: "CloseUp",
    projection: "perspective",
    fov: 28,
    aspect: 1.778,
    near: 0.1,
    far: 500,
  },
];

const lights: LightEntry[] = [];

describe("SceneLightsCamerasCard – USD camera switcher (#34)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders View buttons for each camera when onSelectCamera is provided", () => {
    const { getAllByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={cameras}
        activeCameraName={null}
        onSelectCamera={vi.fn()}
      />,
    );
    const viewButtons = getAllByRole("button", { name: /View/i });
    expect(viewButtons).toHaveLength(cameras.length);
  });

  it("renders a Free Orbit button when onSelectCamera is provided", () => {
    const { getByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={cameras}
        activeCameraName={null}
        onSelectCamera={vi.fn()}
      />,
    );
    expect(getByRole("button", { name: /Free Orbit/i })).toBeTruthy();
  });

  it("does not render camera buttons when onSelectCamera is not provided", () => {
    const { queryAllByRole } = render(
      <SceneLightsCamerasCard lights={lights} cameras={cameras} />,
    );
    const buttons = queryAllByRole("button");
    expect(buttons).toHaveLength(0);
  });

  it("calls onSelectCamera with the camera name when View is clicked", () => {
    const onSelect = vi.fn();
    const { getAllByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={cameras}
        activeCameraName={null}
        onSelectCamera={onSelect}
      />,
    );
    const viewButtons = getAllByRole("button", { name: /View/i });
    fireEvent.click(viewButtons[0]);
    expect(onSelect).toHaveBeenCalledWith("ShotCam");
  });

  it("calls onSelectCamera with null when the active camera button is clicked (toggle off)", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={cameras}
        activeCameraName="ShotCam"
        onSelectCamera={onSelect}
      />,
    );
    // Active camera shows "Active" text instead of "View"
    fireEvent.click(getByRole("button", { name: /Active/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onSelectCamera with null when Free Orbit is clicked", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={cameras}
        activeCameraName="ShotCam"
        onSelectCamera={onSelect}
      />,
    );
    fireEvent.click(getByRole("button", { name: /Free Orbit/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("marks the active camera button as aria-pressed=true", () => {
    const { getByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={cameras}
        activeCameraName="CloseUp"
        onSelectCamera={vi.fn()}
      />,
    );
    const activeBtn = getByRole("button", { name: /Active/i });
    expect(activeBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("returns null when there are no lights or cameras", () => {
    const { container } = render(
      <SceneLightsCamerasCard lights={[]} cameras={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
