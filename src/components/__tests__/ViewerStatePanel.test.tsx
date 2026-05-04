import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ViewerStatePanel } from "../ViewerStatePanel";

describe("ViewerStatePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an action-oriented message for missing optional loaders", () => {
    const { getByText } = render(
      <ViewerStatePanel mode="missingOptionalLoader" fileExtension="vrm" />,
    );

    expect(getByText("VRM Loader Pack is not installed.")).toBeTruthy();
    expect(
      getByText("Install VRM Loader Pack to preview VRM files."),
    ).toBeTruthy();
  });

  it("keeps unknown extensions in the generic unsupported format message", () => {
    const { getByText } = render(
      <ViewerStatePanel mode="unsupported" fileExtension="assetbundle" />,
    );

    expect(getByText("This file format is not supported yet.")).toBeTruthy();
    expect(
      getByText(/No preview loader is available for \.assetbundle/),
    ).toBeTruthy();
  });
});
