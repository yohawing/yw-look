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

  it("shows a settings-oriented message for disabled optional loaders", () => {
    const { getByText } = render(
      <ViewerStatePanel mode="disabledOptionalLoader" fileExtension="vrm" />,
    );

    expect(getByText("VRM Loader Pack is disabled.")).toBeTruthy();
    expect(
      getByText("Enable VRM Loader Pack in Settings to preview VRM files."),
    ).toBeTruthy();
  });

  it("shows a version-oriented message for incompatible optional loaders", () => {
    const { getByText, queryByText } = render(
      <ViewerStatePanel
        mode="incompatibleOptionalLoader"
        fileExtension="vrm"
      />,
    );

    expect(
      getByText("VRM Loader Pack is not compatible with this app version."),
    ).toBeTruthy();
    expect(
      getByText(
        "Update yw-look or reinstall VRM Loader Pack to preview VRM files.",
      ),
    ).toBeTruthy();
    expect(
      queryByText("Enable VRM Loader Pack in Settings to preview VRM files."),
    ).toBeNull();
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
