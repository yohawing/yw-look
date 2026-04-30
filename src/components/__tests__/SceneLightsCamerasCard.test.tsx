/**
 * Tests for the USD camera switcher UI in SceneLightsCamerasCard (#34)
 * and USD light display (#35).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SceneLightsCamerasCard } from "../SceneLightsCamerasCard";
import type { CameraEntry, LightEntry } from "../assetMetadata";
import type { UsdLightInfo } from "../../lib/usd";

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
        activeCameraId={null}
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
        activeCameraId={null}
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

  it("calls onSelectCamera with the camera id when View is clicked", () => {
    const onSelect = vi.fn();
    const { getAllByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={cameras}
        activeCameraId={null}
        onSelectCamera={onSelect}
      />,
    );
    const viewButtons = getAllByRole("button", { name: /View/i });
    fireEvent.click(viewButtons[0]);
    expect(onSelect).toHaveBeenCalledWith("cam-1");
  });

  it("calls onSelectCamera with null when the active camera button is clicked (toggle off)", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={cameras}
        activeCameraId="cam-1"
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
        activeCameraId="cam-1"
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
        activeCameraId="cam-2"
        onSelectCamera={vi.fn()}
      />,
    );
    const activeBtn = getByRole("button", { name: /Active/i });
    expect(activeBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps duplicate-named cameras independently selectable via id", () => {
    // Regression for codex P2: when two cameras share a display name,
    // matching by uuid (id) prevents both rows from looking active and
    // both clicks from firing the same selection.
    const dupes: CameraEntry[] = [
      {
        id: "dup-1",
        name: "Camera",
        projection: "perspective",
        fov: 45,
        aspect: 1.0,
        near: 0.1,
        far: 100,
      },
      {
        id: "dup-2",
        name: "Camera",
        projection: "perspective",
        fov: 60,
        aspect: 1.0,
        near: 0.1,
        far: 100,
      },
    ];
    const onSelect = vi.fn();
    const { getAllByRole } = render(
      <SceneLightsCamerasCard
        lights={lights}
        cameras={dupes}
        activeCameraId="dup-2"
        onSelectCamera={onSelect}
      />,
    );
    const buttons = getAllByRole("button");
    // Two camera rows + one Free Orbit button = 3 total.
    expect(buttons).toHaveLength(3);
    // Only the second camera shows "Active"; the first still shows "View".
    expect(getAllByRole("button", { name: /Active/i })).toHaveLength(1);
    expect(getAllByRole("button", { name: /View/i })).toHaveLength(1);
    // Clicking the View button targets dup-1, not dup-2.
    fireEvent.click(getAllByRole("button", { name: /View/i })[0]);
    expect(onSelect).toHaveBeenCalledWith("dup-1");
  });

  it("returns null when there are no lights or cameras", () => {
    const { container } = render(
      <SceneLightsCamerasCard lights={[]} cameras={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* #35 — USD Lights section                                             */
/* ------------------------------------------------------------------ */

const usdLightSun: UsdLightInfo = {
  primPath: "/World/Sun",
  lightKind: "DistantLight",
  color: [1.0, 0.9, 0.8],
  intensity: 2.0,
  exposure: 0.5,
  colorTemperature: 6500,
  specular: 1.0,
  diffuse: 1.0,
  domeTextureFile: null,
  shapingCone: null,
};

const usdLightDome: UsdLightInfo = {
  primPath: "/World/Dome",
  lightKind: "DomeLight",
  color: [1.0, 1.0, 1.0],
  intensity: 1.0,
  exposure: 0.0,
  colorTemperature: null,
  specular: 0.5,
  diffuse: 0.8,
  domeTextureFile: "/textures/studio.hdr",
  shapingCone: null,
};

const usdLightSpot: UsdLightInfo = {
  primPath: "/World/Spot",
  lightKind: "SphereLight",
  color: [1.0, 1.0, 1.0],
  intensity: 1.0,
  exposure: 0.0,
  colorTemperature: null,
  specular: 1.0,
  diffuse: 1.0,
  domeTextureFile: null,
  shapingCone: { angle: 30.0, softness: 0.1 },
};

describe("SceneLightsCamerasCard – USD Lights section (#35)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a USD Lights section when usdLights is provided", () => {
    const { getByText } = render(
      <SceneLightsCamerasCard
        lights={[]}
        cameras={[]}
        usdLights={[usdLightSun]}
      />,
    );
    expect(getByText(/USD Lights/i)).toBeTruthy();
    expect(getByText("/World/Sun")).toBeTruthy();
  });

  it("shows the lightKind badge without the 'Light' suffix", () => {
    const { getByText } = render(
      <SceneLightsCamerasCard
        lights={[]}
        cameras={[]}
        usdLights={[usdLightSun]}
      />,
    );
    // "DistantLight" → badge shows "Distant"
    expect(getByText("Distant")).toBeTruthy();
  });

  it("shows intensity and exposure when non-zero", () => {
    const { getByText } = render(
      <SceneLightsCamerasCard
        lights={[]}
        cameras={[]}
        usdLights={[usdLightSun]}
      />,
    );
    expect(getByText(/intensity 2.00/)).toBeTruthy();
    expect(getByText(/exp \+0\.50/)).toBeTruthy();
  });

  it("shows color temperature in Kelvin when present", () => {
    const { getByText } = render(
      <SceneLightsCamerasCard
        lights={[]}
        cameras={[]}
        usdLights={[usdLightSun]}
      />,
    );
    expect(getByText(/6500K/)).toBeTruthy();
  });

  it("shows dome texture filename for DomeLight", () => {
    const { getByText } = render(
      <SceneLightsCamerasCard
        lights={[]}
        cameras={[]}
        usdLights={[usdLightDome]}
      />,
    );
    expect(getByText("studio.hdr")).toBeTruthy();
  });

  it("shows specular/diffuse when not both 1.0", () => {
    const { getByText } = render(
      <SceneLightsCamerasCard
        lights={[]}
        cameras={[]}
        usdLights={[usdLightDome]}
      />,
    );
    expect(getByText(/spec 0\.50 diff 0\.80/)).toBeTruthy();
  });

  it("shows shaping cone angle", () => {
    const { getByText } = render(
      <SceneLightsCamerasCard
        lights={[]}
        cameras={[]}
        usdLights={[usdLightSpot]}
      />,
    );
    expect(getByText(/cone 30\.0°/)).toBeTruthy();
  });

  it("hides Three.js lights section when usdLights is provided", () => {
    const threeLights: LightEntry[] = [
      {
        id: "l1",
        name: "ThreeLight",
        type: "PointLight",
        intensity: 1,
        color: "#ffffff",
      },
    ];
    const { queryByText } = render(
      <SceneLightsCamerasCard
        lights={threeLights}
        cameras={[]}
        usdLights={[usdLightSun]}
      />,
    );
    // Three.js light by name should NOT appear when usdLights is provided
    expect(queryByText("ThreeLight")).toBeNull();
    // USD light should appear
    expect(queryByText("/World/Sun")).toBeTruthy();
  });

  it("shows Three.js lights when usdLights is undefined (fallback)", () => {
    const threeLights: LightEntry[] = [
      {
        id: "l1",
        name: "ThreeLight",
        type: "PointLight",
        intensity: 1,
        color: "#ffffff",
      },
    ];
    const { getByText } = render(
      <SceneLightsCamerasCard
        lights={threeLights}
        cameras={[]}
        usdLights={undefined}
      />,
    );
    expect(getByText("ThreeLight")).toBeTruthy();
  });

  it("returns null when usdLights is empty and no Three.js lights or cameras", () => {
    const { container } = render(
      <SceneLightsCamerasCard lights={[]} cameras={[]} usdLights={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
