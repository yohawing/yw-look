import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileBrowserCard } from "../FileBrowserCard";
import type { DirectoryListing, SelectedFile } from "../../lib/files";
import { useFileStore } from "../../stores/fileStore";

describe("FileBrowserCard", () => {
  const makeFile = (overrides: Partial<SelectedFile> = {}): SelectedFile => ({
    path: "/projects/demo/scene.usd",
    fileName: "scene.usd",
    extension: "usd",
    kind: "model",
    parentDirectory: "/projects/demo",
    ...overrides,
  });

  const makeListing = (
    files: SelectedFile[],
    currentIndex: number | null = null,
  ): DirectoryListing => ({
    files,
    currentIndex,
  });

  const renderWithFileState = ({
    currentFile,
    directoryListing,
    onOpenPath = vi.fn(),
  }: {
    currentFile: SelectedFile | null;
    directoryListing: DirectoryListing | null;
    onOpenPath?: (path: string) => void;
  }) => {
    useFileStore.setState({
      currentFile,
      directoryListing,
      assetInspection: null,
      assetMetadata: null,
      packFileRequest: null,
      openError: null,
    });
    render(<FileBrowserCard onOpenPath={onOpenPath} />);
    return { onOpenPath };
  };

  it("renders sibling file names and kind metadata", () => {
    const listing = makeListing([
      makeFile({ path: "/projects/demo/scene.usd", fileName: "scene.usd" }),
      makeFile({
        path: "/projects/demo/model.glb",
        fileName: "model.glb",
        extension: "glb",
        kind: "model",
      }),
    ]);

    renderWithFileState({ currentFile: makeFile(), directoryListing: listing });

    expect(screen.queryByText("scene.usd")).not.toBeNull();
    expect(screen.queryByText("model.glb")).not.toBeNull();
    expect(screen.getAllByText("USD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GLB").length).toBeGreaterThan(0);
  });

  it("calls onOpenPath with file path when a row is clicked", () => {
    const onOpenPath = vi.fn();
    const listing = makeListing([
      makeFile({ path: "/projects/demo/scene.usd", fileName: "scene.usd" }),
    ]);

    renderWithFileState({
      currentFile: makeFile(),
      directoryListing: listing,
      onOpenPath,
    });

    fireEvent.click(screen.getByRole("button"));

    expect(onOpenPath).toHaveBeenCalledTimes(1);
    expect(onOpenPath).toHaveBeenCalledWith("/projects/demo/scene.usd");
  });

  it("marks the current file row with is-current", () => {
    const currentFile = makeFile({
      path: "/projects/demo/scene.usd",
      fileName: "scene.usd",
    });
    const listing = makeListing([
      currentFile,
      makeFile({
        path: "/projects/demo/other.usd",
        fileName: "other.usd",
      }),
    ]);

    renderWithFileState({ currentFile, directoryListing: listing });

    const buttons = screen.getAllByRole("button");
    expect(buttons[0].classList.contains("file-item-row")).toBe(true);
    expect(buttons[0].classList.contains("file-browser-entry")).toBe(true);
    expect(buttons[0].classList.contains("is-current")).toBe(true);
    expect(buttons[0].getAttribute("aria-current")).toBe("true");
    expect(buttons[1].classList.contains("file-item-row")).toBe(true);
    expect(buttons[1].classList.contains("file-browser-entry")).toBe(true);
    expect(buttons[1].classList.contains("is-current")).toBe(false);
  });

  it("renders rows as buttons preserving ul > li > button", () => {
    const listing = makeListing([
      makeFile({ path: "/a/one.usd", fileName: "one.usd" }),
      makeFile({ path: "/b/two.usd", fileName: "two.usd" }),
    ]);

    renderWithFileState({
      currentFile: makeFile({ parentDirectory: "/a" }),
      directoryListing: listing,
    });

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.parentElement?.tagName).toBe("LI");
      expect(button.parentElement?.parentElement?.tagName).toBe("UL");
      expect(button.classList.contains("yl-button")).toBe(true);
      expect(button.classList.contains("yl-button--unstyled")).toBe(true);
      expect(button.classList.contains("yl-selectable-list-item")).toBe(true);
      expect(button.classList.contains("file-item-row")).toBe(true);
      expect(button.classList.contains("file-browser-entry")).toBe(true);
    }
  });
});
