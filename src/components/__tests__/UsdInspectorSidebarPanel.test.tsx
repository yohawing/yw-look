import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { UsdInspectorSidebarPanel } from "../UsdInspectorSidebarPanel";
import { useViewerStore } from "../../stores/viewerStore";
import type { AssetIssue, StageInspection, StageSummary } from "../../lib/usd";

const inspectionWithVariant: StageInspection = {
  path: "F:\\assets\\scene.usda",
  defaultPrim: null,
  upAxis: null,
  metersPerUnit: null,
  timeCodesPerSecond: null,
  framesPerSecond: null,
  startTimeCode: null,
  endTimeCode: null,
  comment: null,
  rootLayerIsBinary: false,
  rootPrims: ["/World"],
  composedLayers: [],
  layers: [],
  references: [],
  payloads: [],
  missingAssets: [],
  variantSets: [
    {
      primPath: "/World/Hero",
      setName: "look",
      selection: "default",
      variants: ["default", "toon"],
    },
  ],
  loadPolicy: "loadAll",
};

const inspectionWithSupportedVariant: StageInspection = {
  ...inspectionWithVariant,
  capabilities: [
    {
      kind: "variantOverride",
      detected: true,
      support: "supported",
      reason: "",
    },
  ],
};

const inspectionWithLayer: StageInspection = {
  ...inspectionWithVariant,
  layers: [
    {
      identifier: "file:///F:/assets/root.usda",
      depth: 0,
      muted: false,
      timeOffset: 0,
      timeScale: 1,
      comment: null,
    },
    {
      identifier: "file:///F:/assets/materials.usda",
      depth: 1,
      muted: true,
      timeOffset: 24,
      timeScale: 1,
      comment: "layer note",
    },
  ],
  variantSets: [],
};

const issues: AssetIssue[] = [
  {
    code: "suspicious-meters-per-unit",
    level: "warning",
    message: "Meters per unit is unusually small.",
    detail: null,
    contextPath: "/World",
  },
  {
    code: "broken-reference",
    level: "error",
    message: "Reference could not be resolved.",
    detail: null,
    contextPath: "/World/Hero",
  },
];

const capabilityInspection: StageInspection = {
  ...inspectionWithVariant,
  capabilities: [
    {
      kind: "pointInstancer",
      detected: true,
      support: "unsupported",
      reason: "Inspection capability should lose to summary.",
    },
    {
      kind: "materialX",
      detected: true,
      support: "supported",
      reason: "Inspection capability should lose to summary.",
    },
    {
      kind: "variantOverride",
      detected: true,
      support: "unsupported",
      reason: "Inspection-only capability should not be duplicated.",
    },
  ],
};

const capabilitySummary: StageSummary = {
  path: "F:\\assets\\scene.usda",
  layerCount: 1,
  rootPrimCount: 1,
  meshCount: 1,
  payloadCount: 0,
  unloadedPayloadCount: 0,
  hasVariants: false,
  primTypeCounts: [],
  totalVertices: 3,
  totalTriangles: 1,
  variantSetCount: 0,
  durationSeconds: null,
  resolvedReferenceCount: 0,
  unresolvedReferenceCount: 0,
  resolvedPayloadCount: 0,
  unresolvedPayloadCount: 0,
  warnings: [],
  loadPolicy: "loadAll",
  capabilities: [
    {
      kind: "pointInstancer",
      detected: true,
      support: "supported",
      reason: "",
    },
    {
      kind: "materialX",
      detected: true,
      support: "degraded",
      reason: "MaterialX preview is limited to known shader aliases.",
    },
    {
      kind: "usdAuthoredSplat",
      detected: true,
      support: "unsupported",
      reason: "USD-authored Points/splat geometry is not supported.",
    },
    {
      kind: "skel",
      detected: false,
      support: "degraded",
      reason: "Undetected capability should remain hidden.",
    },
  ],
};

beforeEach(() => {
  useViewerStore.setState({
    usdLoadPolicy: "loadAll",
    variantSelectionError: null,
    variantSelections: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("UsdInspectorSidebarPanel", () => {
  it("updates the USD load policy through the viewer store", () => {
    const { getByRole } = render(
      <UsdInspectorSidebarPanel
        error={null}
        inspection={null}
        issues={[]}
        loading={false}
        summary={null}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Deferred" }));

    expect(useViewerStore.getState().usdLoadPolicy).toBe("noPayloads");
  });

  it("stores variant selections and clears the previous variant error", () => {
    useViewerStore.setState({
      variantSelectionError: "Previous failure",
    });
    const { container, queryByText } = render(
      <UsdInspectorSidebarPanel
        error={null}
        inspection={inspectionWithSupportedVariant}
        issues={[]}
        loading={false}
        summary={null}
      />,
    );

    expect(queryByText("Previous failure")).toBeTruthy();
    expect(container.querySelector(".yl-list")).toBeTruthy();
    expect(container.querySelector(".yl-list-row")).toBeTruthy();
    expect(
      container.querySelector(".yl-list-row__path")?.textContent,
    ).toContain("/World/Hero");

    fireEvent.change(container.querySelector("select")!, {
      target: { value: "toon" },
    });

    expect(useViewerStore.getState().variantSelectionError).toBeNull();
    expect(useViewerStore.getState().variantSelections).toEqual([
      {
        primPath: "/World/Hero",
        setName: "look",
        variantName: "toon",
      },
    ]);
  });

  it("keeps variant selection read-only when override capability is unsupported", () => {
    const unsupportedInspection: StageInspection = {
      ...inspectionWithVariant,
      capabilities: [
        {
          kind: "variantOverride",
          detected: true,
          support: "unsupported",
          reason: "Variant session overrides are not supported.",
        },
      ],
    };
    const { container, getByText } = render(
      <UsdInspectorSidebarPanel
        error={null}
        inspection={unsupportedInspection}
        issues={[]}
        loading={false}
        summary={null}
      />,
    );

    expect(container.querySelector("select")).toBeNull();
    expect(getByText("default")).toBeTruthy();
  });

  it("renders layer rows through the shared list row primitive", () => {
    const { container, getByText } = render(
      <UsdInspectorSidebarPanel
        error={null}
        inspection={inspectionWithLayer}
        issues={[]}
        loading={false}
        summary={null}
      />,
    );

    const rows = container.querySelectorAll(".yl-list-row--indented");

    expect(container.querySelector(".yl-list")).toBeTruthy();
    expect(rows).toHaveLength(2);
    expect(
      (rows[1] as HTMLElement).style.getPropertyValue("--layer-depth"),
    ).toBe("1");
    expect(getByText("muted")).toBeTruthy();
    expect(getByText("offset:24")).toBeTruthy();
    expect(getByText("layer note")).toBeTruthy();
  });

  it("renders issue rows through the shared status row primitive", () => {
    const { container, getByText } = render(
      <UsdInspectorSidebarPanel
        error={null}
        inspection={inspectionWithVariant}
        issues={issues}
        loading={false}
        summary={null}
      />,
    );

    const statusRows = container.querySelectorAll(".yl-status-row");

    expect(container.querySelector(".yl-status-list")).toBeTruthy();
    expect(statusRows).toHaveLength(2);
    expect(statusRows[0].classList.contains("yl-status-row--warning")).toBe(
      true,
    );
    expect(statusRows[1].classList.contains("yl-status-row--error")).toBe(true);
    expect(getByText("suspicious-meters-per-unit")).toBeTruthy();
    expect(getByText("broken-reference")).toBeTruthy();
  });

  it("renders detected stage capabilities with summary precedence", () => {
    const { container, getByText, queryByText } = render(
      <UsdInspectorSidebarPanel
        error={null}
        inspection={capabilityInspection}
        issues={[]}
        loading={false}
        summary={capabilitySummary}
      />,
    );

    expect(getByText("Capabilities")).toBeTruthy();
    expect(getByText("Point Instancer")).toBeTruthy();
    expect(getByText("supported")).toBeTruthy();
    expect(getByText("MaterialX")).toBeTruthy();
    expect(getByText("degraded")).toBeTruthy();
    expect(
      getByText("MaterialX preview is limited to known shader aliases."),
    ).toBeTruthy();
    expect(getByText("USD-authored Splat")).toBeTruthy();
    expect(getByText("unsupported")).toBeTruthy();
    expect(
      getByText("USD-authored Points/splat geometry is not supported."),
    ).toBeTruthy();

    expect(
      queryByText("Undetected capability should remain hidden."),
    ).toBeNull();
    expect(
      queryByText("Inspection capability should lose to summary."),
    ).toBeNull();
    expect(
      queryByText("Inspection-only capability should not be duplicated."),
    ).toBeNull();
    expect(container.querySelectorAll(".yl-status-row")).toHaveLength(3);
    expect(
      container.querySelectorAll(
        ".yl-status-row > .yl-list-row__main > strong",
      ),
    ).toHaveLength(3);
  });
});
