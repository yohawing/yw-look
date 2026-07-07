import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CompositionArcsCard } from "../CompositionArcsCard";
import type { StageInspection } from "../../lib/usd";

const inspectionWithArcs: StageInspection = {
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
  references: [
    {
      sourcePrim: "/World/Hero",
      assetPath: "missing.usda",
      targetPrim: "/Hero",
      state: "missing",
      kind: "reference",
    },
    {
      sourcePrim: "/World/Props",
      assetPath: "props.usda",
      targetPrim: "/Props",
      state: "loaded",
      kind: "reference",
    },
  ],
  payloads: [],
  missingAssets: [],
  variantSets: [],
  loadPolicy: "loadAll",
};

afterEach(() => {
  cleanup();
});

describe("CompositionArcsCard", () => {
  it("renders composition arc rows through the shared status row primitive", () => {
    const { container } = render(
      <CompositionArcsCard inspection={inspectionWithArcs} loading={false} />,
    );

    const statusLists = container.querySelectorAll(".yl-status-list");
    const statusRows = container.querySelectorAll(".yl-status-row");

    expect(statusLists.length).toBeGreaterThan(0);
    expect(statusRows).toHaveLength(2);
    expect(statusRows[0].classList.contains("yl-status-row--error")).toBe(true);
    expect(statusRows[1].classList.contains("yl-status-row--error")).toBe(
      false,
    );
    expect(container.textContent).toContain("missing.usda");
    expect(container.textContent).toContain("props.usda");
  });
});
