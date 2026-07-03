import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { PointerEvent } from "react";
import { useSidebarModel } from "../useSidebarModel";
import { useUiStore } from "../../stores/uiStore";
import { useFileStore } from "../../stores/fileStore";
import { useViewerStore } from "../../stores/viewerStore";
import type { AssetIssue } from "../../lib/usd";
import type { MmdAssetMetadata } from "../../types/viewer";

type SidebarModelTestOptions = Parameters<typeof useSidebarModel>[0];

function makeOptions(
  overrides: Partial<SidebarModelTestOptions> = {},
): SidebarModelTestOptions {
  return {
    handleCheckForUpdate: vi.fn(() => Promise.resolve()),
    handleInstallOptionalLoaderPack: vi.fn(() => Promise.resolve()),
    handleInstallUpdate: vi.fn(() => Promise.resolve()),
    handleLoadPayload: vi.fn(() => Promise.resolve()),
    handleRemoveOptionalLoaderPack: vi.fn(() => Promise.resolve()),
    handleToggleAutoCheckForUpdates: vi.fn(() => Promise.resolve()),
    handleToggleFileAssociations: vi.fn(() => Promise.resolve()),
    handleToggleOptionalLoaderPack: vi.fn(() => Promise.resolve()),
    handleUnloadPayload: vi.fn(() => Promise.resolve()),
    integrationError: null,
    integrationPayload: null,
    isCheckingForUpdate: false,
    isInstallingUpdate: false,
    isTauri: false,
    optionalLoaderManifests: [],
    optionalLoaderManifestsError: null,
    payloadPrimPaths: new Set<string>(),
    performSelectFilePath: vi.fn(() => Promise.resolve()),
    recentFilesError: null,
    recentFilesPayload: null,
    sessionAdjustedUsdSummary: null,
    setRecentFilesError: vi.fn(),
    settingsError: null,
    settingsPayload: null,
    stageSessionHandle: null,
    unloadedPayloadPaths: new Set<string>(),
    updateCheck: null,
    updateConfiguration: null,
    updateError: null,
    usdInspection: null,
    usdInspectorError: null,
    usdInspectorLoading: false,
    usdIssues: [],
    usdLights: null,
    usdLightsError: null,
    ...overrides,
  };
}

beforeEach(() => {
  useUiStore.setState({
    activeTab: "properties",
    sidebarWidth: 350,
  });
  useFileStore.setState({
    assetInspection: null,
    assetMetadata: null,
    currentFile: null,
    directoryListing: null,
    packFileRequest: null,
    openError: null,
    packMetadata: null,
  });
  useViewerStore.setState({
    viewerFeedback: {
      mode: "empty",
      message: "Open a supported asset to initialize the preview scene.",
      warning: null,
      canResetCamera: false,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useSidebarModel", () => {
  it("renders pack metadata cards in the properties tab", () => {
    const mmdMetadata: MmdAssetMetadata = {
      format: "pmx",
      version: 2.1,
      encoding: "utf-8",
      name: "初音ミク",
      englishName: "Hatsune Miku",
      comment: "",
      englishComment: "",
      counts: {},
      additionalUvCount: 0,
      indexSizes: null,
      trailingBytes: 0,
      sections: [],
      diagnostics: [],
    };
    useFileStore.setState({
      packMetadata: { kind: "mmd", asset: mmdMetadata },
    });

    const { result } = renderHook(() => useSidebarModel(makeOptions()));

    render(<>{result.current.sidebarContent}</>);

    expect(screen.getByText("MMD Model")).toBeTruthy();
    expect(screen.getByText("Hatsune Miku")).toBeTruthy();
  });

  it("reads the active sidebar tab and warning content from stores", () => {
    useUiStore.setState({ activeTab: "warnings" });
    useViewerStore.setState({
      viewerFeedback: {
        mode: "ready",
        message: "Preview ready.",
        warning: "runtime warning",
        canResetCamera: true,
      },
    });
    const { result } = renderHook(() => useSidebarModel(makeOptions()));

    render(<>{result.current.sidebarContent}</>);

    expect(screen.getByText("runtime warning")).toBeTruthy();
  });

  it("builds the warnings tab badge from USD issues", () => {
    const usdIssues: AssetIssue[] = [
      {
        code: "broken-reference",
        level: "error",
        message: "Missing referenced layer.",
        detail: null,
        contextPath: "/Root",
      },
    ];
    const { result } = renderHook(() =>
      useSidebarModel(makeOptions({ usdIssues })),
    );

    const warningsTab = result.current.sidebarTabs.find(
      (tab) => tab.id === "warnings",
    );

    expect(warningsTab?.badge).toEqual({
      count: 1,
      tone: "danger",
    });
  });

  it("uses the ui store sidebar width as the resize baseline", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000,
    });
    useUiStore.setState({ sidebarWidth: 320 });
    const { result } = renderHook(() => useSidebarModel(makeOptions()));

    act(() => {
      result.current.handleSidebarResizeStart({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent<HTMLDivElement>);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 450 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });

    expect(useUiStore.getState().sidebarWidth).toBe(370);
  });
});
