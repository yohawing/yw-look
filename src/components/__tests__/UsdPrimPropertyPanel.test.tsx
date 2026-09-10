import { Activity } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsdPrimPropertyPanel } from "../UsdPrimPropertyPanel";
import { inspectAttributeTimeSamples, inspectPrim } from "../../lib/usd";
import { useViewerStore } from "../../stores/viewerStore";
import type { AttributeTimeSamples, PrimInspection } from "../../types/ipc";

vi.mock("../../lib/usd", () => ({
  inspectAttributeTimeSamples: vi.fn(),
  inspectPrim: vi.fn(),
}));

const assetPath = "F:\\assets\\scene.usda";

describe("UsdPrimPropertyPanel", () => {
  afterEach(() => {
    cleanup();
    useViewerStore.setState({ selectedUsdPrimPath: null });
    vi.mocked(inspectPrim).mockReset();
    vi.mocked(inspectAttributeTimeSamples).mockReset();
  });

  it("shows prim inspection error details inline", async () => {
    vi.mocked(inspectPrim).mockRejectedValue(
      new Error("Backend failed to inspect /World/Hero."),
    );
    useViewerStore.setState({ selectedUsdPrimPath: "/World/Hero" });

    const { getByText } = render(
      <UsdPrimPropertyPanel path="F:\\assets\\scene.usda" />,
    );

    await waitFor(() => {
      expect(
        getByText(
          "Prim inspection failed: Backend failed to inspect /World/Hero.",
        ),
      ).toBeTruthy();
    });
  });

  it("supports embedded display under the Selected inspector", async () => {
    vi.mocked(inspectPrim).mockResolvedValue({
      primPath: "/World/Hero",
      attributes: [
        {
          name: "visibility",
          typeName: "token",
          valueSummary: "inherited",
          variability: "uniform",
          custom: false,
          timeSampleCount: 0,
        },
      ],
      relationships: [
        {
          name: "material:binding",
          targets: ["/World/Looks/HeroMaterial"],
        },
      ],
      metadata: [{ key: "kind", valueSummary: "component" }],
    });
    useViewerStore.setState({ selectedUsdPrimPath: "/World/Hero" });

    const { container, getByText } = render(
      <UsdPrimPropertyPanel embedded path={assetPath} />,
    );

    await waitFor(() => expect(getByText("USD Properties")).toBeTruthy());
    expect(container.querySelector(".prim-property-panel")).toBeTruthy();
    expect(
      container.querySelector('[data-testid="usd-prim-panel"]'),
    ).toBeTruthy();
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("summary")).toBeNull();
    expect(getByText("visibility")).toBeTruthy();
    expect(getByText("material:binding")).toBeTruthy();
    expect(getByText("kind")).toBeTruthy();
    expect(container.textContent).not.toContain(assetPath);
  });

  it("renders authored attributes, relationships, and metadata", async () => {
    const inspection: PrimInspection = {
      primPath: "/World/Hero",
      attributes: [
        {
          name: "visibility",
          typeName: "token",
          valueSummary: "inherited",
          variability: "uniform",
          custom: false,
          timeSampleCount: 0,
        },
        {
          name: "custom:strength",
          typeName: "double",
          valueSummary: "0.75",
          variability: "varying",
          custom: true,
          timeSampleCount: 3,
        },
      ],
      relationships: [
        {
          name: "material:binding",
          targets: ["/World/Looks/HeroMaterial"],
        },
      ],
      metadata: [{ key: "kind", valueSummary: "component" }],
    };
    vi.mocked(inspectPrim).mockResolvedValue(inspection);
    useViewerStore.setState({ selectedUsdPrimPath: "/World/Hero" });

    const { container } = render(<UsdPrimPropertyPanel path={assetPath} />);

    await waitFor(() =>
      expect(screen.getByText("custom:strength")).toBeTruthy(),
    );
    fireEvent.click(container.querySelector("summary")!);

    expect(screen.getByText("visibility")).toBeTruthy();
    expect(screen.getByText("inherited")).toBeTruthy();
    expect(screen.getByText("uniform")).toBeTruthy();
    expect(screen.getByText("double")).toBeTruthy();
    expect(screen.getByText("0.75")).toBeTruthy();
    expect(screen.getByText("varying")).toBeTruthy();
    expect(
      container.querySelector(".prop-table-custom .yl-badge")?.textContent,
    ).toBe("C");
    expect(screen.getByText("material:binding")).toBeTruthy();
    expect(screen.getByText("/World/Looks/HeroMaterial")).toBeTruthy();
    expect(screen.getByText("kind")).toBeTruthy();
    expect(screen.getByText("component")).toBeTruthy();
  });

  it("keeps expanded time samples across tab hiding and revalidation", async () => {
    const inspection: PrimInspection = {
      primPath: "/World/Hero",
      attributes: [
        {
          name: "custom:strength",
          typeName: "double",
          valueSummary: "0.75",
          variability: "varying",
          custom: true,
          timeSampleCount: 150,
        },
      ],
      relationships: [],
      metadata: [],
    };
    const samples: AttributeTimeSamples = {
      primPath: "/World/Hero",
      attributeName: "custom:strength",
      samples: [
        { time: 1, valueSummary: "1" },
        { time: 2, valueSummary: "3" },
      ],
      totalCount: 150,
      numericMin: 1,
      numericMax: 3,
      numericMean: 2,
    };
    vi.mocked(inspectPrim).mockResolvedValue(inspection);
    vi.mocked(inspectAttributeTimeSamples).mockResolvedValue(samples);
    useViewerStore.setState({ selectedUsdPrimPath: "/World/Hero" });

    const panel = <UsdPrimPropertyPanel path={assetPath} />;
    const { container, rerender } = render(
      <Activity mode="visible">{panel}</Activity>,
    );

    await waitFor(() =>
      expect(screen.getByText("custom:strength")).toBeTruthy(),
    );
    fireEvent.click(container.querySelector("summary")!);
    fireEvent.click(screen.getByRole("button", { name: "150s" }));

    await waitFor(() =>
      expect(inspectAttributeTimeSamples).toHaveBeenCalledWith(
        assetPath,
        "/World/Hero",
        "custom:strength",
        100,
      ),
    );
    rerender(<Activity mode="hidden">{panel}</Activity>);
    let resolveRefresh!: (value: PrimInspection) => void;
    vi.mocked(inspectPrim).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    rerender(<Activity mode="visible">{panel}</Activity>);
    await waitFor(() => expect(inspectPrim).toHaveBeenCalledTimes(2));
    expect(container.querySelector(".ts-panel")).toBeTruthy();
    expect(screen.getByText("Showing first 2 of 150 samples")).toBeTruthy();
    resolveRefresh(inspection);
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(screen.getByText("Showing first 2 of 150 samples")).toBeTruthy();
    expect(container.querySelector(".ts-stats")?.textContent).toContain(
      "1.0000",
    );
    expect(container.querySelector(".ts-stats")?.textContent).toContain(
      "3.0000",
    );
    expect(container.querySelector(".ts-stats")?.textContent).toContain(
      "2.0000",
    );
  });

  it("does not retain an expanded sample panel after prim selection changes", async () => {
    const firstInspection: PrimInspection = {
      primPath: "/World/First",
      attributes: [
        {
          name: "translate:x",
          typeName: "double",
          valueSummary: "1",
          variability: "varying",
          custom: false,
          timeSampleCount: 2,
        },
      ],
      relationships: [],
      metadata: [],
    };
    const secondInspection: PrimInspection = {
      primPath: "/World/Second",
      attributes: [
        {
          name: "visibility",
          typeName: "token",
          valueSummary: "inherited",
          variability: "uniform",
          custom: false,
          timeSampleCount: 0,
        },
      ],
      relationships: [],
      metadata: [],
    };
    vi.mocked(inspectPrim)
      .mockResolvedValueOnce(firstInspection)
      .mockResolvedValueOnce(secondInspection);
    vi.mocked(inspectAttributeTimeSamples).mockResolvedValue({
      primPath: "/World/First",
      attributeName: "translate:x",
      samples: [{ time: 1, valueSummary: "old sample" }],
      totalCount: 1,
      numericMin: null,
      numericMax: null,
      numericMean: null,
    });
    useViewerStore.setState({ selectedUsdPrimPath: "/World/First" });

    const { container } = render(<UsdPrimPropertyPanel path={assetPath} />);

    await waitFor(() => expect(screen.getByText("translate:x")).toBeTruthy());
    fireEvent.click(container.querySelector("summary")!);
    fireEvent.click(screen.getByRole("button", { name: "2s" }));
    await waitFor(() => expect(screen.getByText("old sample")).toBeTruthy());

    useViewerStore.setState({ selectedUsdPrimPath: "/World/Second" });

    await waitFor(() => expect(screen.getByText("visibility")).toBeTruthy());
    expect(screen.queryByText("old sample")).toBeNull();
    expect(container.querySelector(".ts-panel")).toBeNull();
  });
});
