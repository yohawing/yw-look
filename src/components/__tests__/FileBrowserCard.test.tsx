import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileBrowserCard } from "../FileBrowserCard";
import type { DirectoryListing, SelectedFile } from "../../lib/files";

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

    render(
      <FileBrowserCard
        currentFile={makeFile()}
        directoryListing={listing}
        onOpenPath={vi.fn()}
      />,
    );

    expect(screen.queryByText("scene.usd")).not.toBeNull();
    expect(screen.queryByText("model.glb")).not.toBeNull();
    expect(screen.queryByText("USD")).not.toBeNull();
    expect(screen.queryByText("GLB")).not.toBeNull();
  });

  it("calls onOpenPath with file path when a row is clicked", () => {
    const onOpenPath = vi.fn();
    const listing = makeListing([
      makeFile({ path: "/projects/demo/scene.usd", fileName: "scene.usd" }),
    ]);

    render(
      <FileBrowserCard
        currentFile={makeFile()}
        directoryListing={listing}
        onOpenPath={onOpenPath}
      />,
    );

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

    render(
      <FileBrowserCard
        currentFile={currentFile}
        directoryListing={listing}
        onOpenPath={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons[0].classList.contains("file-browser-entry")).toBe(true);
    expect(buttons[0].classList.contains("is-current")).toBe(true);
    expect(buttons[1].classList.contains("file-browser-entry")).toBe(true);
    expect(buttons[1].classList.contains("is-current")).toBe(false);
  });

  it("renders rows as buttons preserving ul > li > button", () => {
    const listing = makeListing([
      makeFile({ path: "/a/one.usd", fileName: "one.usd" }),
      makeFile({ path: "/b/two.usd", fileName: "two.usd" }),
    ]);

    render(
      <FileBrowserCard
        currentFile={makeFile({ parentDirectory: "/a" })}
        directoryListing={listing}
        onOpenPath={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.parentElement?.tagName).toBe("LI");
      expect(button.parentElement?.parentElement?.tagName).toBe("UL");
      expect(button.classList.contains("yl-button")).toBe(true);
      expect(button.classList.contains("yl-button--unstyled")).toBe(true);
      expect(button.classList.contains("file-browser-entry")).toBe(true);
    }
  });
});
