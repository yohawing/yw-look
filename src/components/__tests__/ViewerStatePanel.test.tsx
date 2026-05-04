import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ViewerStatePanel } from "../ViewerStatePanel";

describe("ViewerStatePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes the primary open-file action in the empty state", () => {
    const onOpenFile = vi.fn();
    const { getByRole, getByLabelText, getByText } = render(
      <ViewerStatePanel mode="empty" onOpenFile={onOpenFile} />,
    );

    fireEvent.click(getByRole("button", { name: "Open File" }));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(getByText("Core")).toBeTruthy();
    expect(
      within(getByLabelText("Optional formats")).getByText("vrm"),
    ).toBeTruthy();
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
