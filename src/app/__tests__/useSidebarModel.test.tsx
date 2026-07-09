import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PointerEvent } from "react";
import { useSidebarModel } from "../useSidebarModel";
import { useUiStore } from "../../stores/uiStore";
import { useFileStore } from "../../stores/fileStore";
import { useViewerStore } from "../../stores/viewerStore";
import type { AssetIssue } from "../../lib/usd";
import type { UpdateCheckPayload } from "../../lib/updater";
import type { MmdAssetMetadata } from "../../types/viewer";
import type { SettingsPayload } from "../../lib/settings";

const diagnosticsMocks = vi.hoisted(() => ({
  loadDiagnosticsSnapshot: vi.fn(),
  openAppLogDir: vi.fn(),
}));

vi.mock("../../lib/diagnostics", () => ({
  loadDiagnosticsSnapshot: diagnosticsMocks.loadDiagnosticsSnapshot,
  openAppLogDir: diagnosticsMocks.openAppLogDir,
}));

type SidebarModelTestOptions = Parameters<typeof useSidebarModel>[0];

const settingsPayload: SettingsPayload = {
  settingsPath: "C:\\Users\\yohaw\\AppData\\Roaming\\yw-look\\settings.json",
  settings: {
    version: 1,
    recentFilesLimit: 10,
    diagnosticsLogLevel: "warn",
    fileAssociationsEnabled: false,
    optionalLoaderPacks: {},
    updateEndpointOverride: null,
    updatePublicKeyOverride: null,
    allowInsecureUpdateEndpoint: false,
    autoCheckForUpdates: true,
  },
};

function makeOptions(
  overrides: Partial<SidebarModelTestOptions> = {},
): SidebarModelTestOptions {
  return {
    handleCheckForUpdate: vi.fn(() => Promise.resolve()),
    handleInstallUpdate: vi.fn(() => Promise.resolve()),
    handleLoadPayload: vi.fn(() => Promise.resolve()),
    handleToggleAutoCheckForUpdates: vi.fn(() => Promise.resolve()),
    handleToggleOptionalLoaderPack: vi.fn(() => Promise.resolve()),
    handleUnloadPayload: vi.fn(() => Promise.resolve()),
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
  diagnosticsMocks.loadDiagnosticsSnapshot.mockResolvedValue({
    appLogDir: "C:/logs/yw-look",
    appVersion: "0.2.2-test",
    arch: "x64",
    diagnosticsLogPath: "C:/logs/yw-look/diagnostics.log",
    diagnosticsSnapshot: ["[viewer.loadFailed] Failed to load preview."],
    platform: "windows",
  });
  diagnosticsMocks.openAppLogDir.mockResolvedValue(undefined);
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

  it("builds the warnings tab dot from USD issues", () => {
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
      label: "Active diagnostics",
      tone: "danger",
    });
  });

  it("adds an update dot to the settings tab when an update is available", () => {
    const updateCheck: UpdateCheckPayload = {
      configuration: {
        currentVersion: "0.1.9",
        defaultEndpoint: "https://example.com/latest.json",
        defaultPubkeyAvailable: true,
        effectiveEndpoint: "https://example.com/latest.json",
        effectivePubkeyAvailable: true,
        usingOverrideEndpoint: false,
        usingOverridePubkey: false,
        allowInsecureUpdateEndpoint: false,
      },
      update: {
        version: "0.2.0",
        currentVersion: "0.1.9",
        target: "windows-x86_64",
        downloadUrl: "https://example.com/yw-look.exe",
      },
    };
    const { result } = renderHook(() =>
      useSidebarModel(makeOptions({ updateCheck })),
    );

    const settingsTab = result.current.sidebarTabs.find(
      (tab) => tab.id === "settings",
    );

    expect(settingsTab?.badge).toEqual({
      label: "Update available: 0.2.0",
      tone: "warning",
    });
  });

  it("exposes diagnostics actions from the settings tab", async () => {
    useUiStore.setState({ activeTab: "settings" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { result } = renderHook(() =>
      useSidebarModel(makeOptions({ settingsPayload })),
    );

    render(<>{result.current.sidebarContent}</>);

    expect(
      await screen.findByRole("button", { name: "Open Logs" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy Diagnostics" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText("Recent diagnostics").textContent).toContain(
        "[viewer.loadFailed] Failed to load preview.",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Logs" }));
    expect(diagnosticsMocks.openAppLogDir).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Copy Diagnostics" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const report = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(report).toContain(
      "Diagnostics log: C:/logs/yw-look/diagnostics.log",
    );
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

  it("cleans up sidebar resize state on pointer cancel", () => {
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
    expect(document.body.classList.contains("is-resizing-sidebar")).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("pointercancel"));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 450 }));
    });

    expect(document.body.classList.contains("is-resizing-sidebar")).toBe(false);
    expect(useUiStore.getState().sidebarWidth).toBe(320);
  });

  it("cleans up sidebar resize state on window blur", () => {
    useUiStore.setState({ sidebarWidth: 320 });
    const { result } = renderHook(() => useSidebarModel(makeOptions()));

    act(() => {
      result.current.handleSidebarResizeStart({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent<HTMLDivElement>);
    });
    expect(document.body.classList.contains("is-resizing-sidebar")).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 450 }));
    });

    expect(document.body.classList.contains("is-resizing-sidebar")).toBe(false);
    expect(useUiStore.getState().sidebarWidth).toBe(320);
  });

  it("cleans up sidebar resize state on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useSidebarModel(makeOptions()),
    );

    act(() => {
      result.current.handleSidebarResizeStart({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent<HTMLDivElement>);
    });
    expect(document.body.classList.contains("is-resizing-sidebar")).toBe(true);

    unmount();

    expect(document.body.classList.contains("is-resizing-sidebar")).toBe(false);
  });
});
