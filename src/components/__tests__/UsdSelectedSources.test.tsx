import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { UsdSelectedSources } from "../UsdSelectedSources";
import type { StageInspection } from "../../lib/usd";
const inspection = {
  references: [
    {
      sourcePrim: "/World/Hero",
      assetPath: "hero.usda",
      targetPrim: "/Hero",
      state: "loaded",
    },
    {
      sourcePrim: "/World/Hero/Child",
      assetPath: "child.usda",
      targetPrim: "/Child",
      state: "loaded",
    },
    {
      sourcePrim: "/World/Props",
      assetPath: "props.usda",
      targetPrim: "/Props",
      state: "missing",
    },
  ],
  payloads: [
    {
      sourcePrim: "/World/Hero",
      assetPath: "detail.usda",
      targetPrim: "/Detail",
      state: "loaded",
    },
  ],
} as StageInspection;
afterEach(cleanup);
describe("UsdSelectedSources", () => {
  it("shows only references and payloads authored on the selected prim", () => {
    const view = render(
      <UsdSelectedSources inspection={inspection} primPath="/World/Hero" />,
    );
    expect(view.getByText("hero.usda")).toBeTruthy();
    expect(view.getByText("detail.usda")).toBeTruthy();
    expect(view.queryByText("child.usda")).toBeNull();
    expect(view.queryByText("props.usda")).toBeNull();
    view.rerender(
      <UsdSelectedSources inspection={inspection} primPath="/World/Props" />,
    );
    expect(view.queryByText("hero.usda")).toBeNull();
    expect(view.getByText("props.usda")).toBeTruthy();
    expect(view.getByText("missing")).toBeTruthy();
  });
  it("does not leave content after clearing selection or inspection", () => {
    const view = render(
      <UsdSelectedSources inspection={inspection} primPath={null} />,
    );
    expect(view.container.textContent).toBe("");
    view.rerender(
      <UsdSelectedSources inspection={null} primPath="/World/Hero" />,
    );
    expect(view.container.textContent).toBe("");
  });
  it("reflects the current payload session state", () => {
    const view = render(
      <UsdSelectedSources
        inspection={inspection}
        primPath="/World/Hero"
        payloadLoaded={false}
      />,
    );
    expect(view.getByText("unloaded")).toBeTruthy();
    view.rerender(
      <UsdSelectedSources
        inspection={inspection}
        primPath="/World/Hero"
        payloadLoaded
      />,
    );
    expect(view.queryByText("unloaded")).toBeNull();
  });
});
