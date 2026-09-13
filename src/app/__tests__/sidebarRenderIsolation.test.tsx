import { Profiler, type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarModel } from "../useSidebarModel";
import { useViewportToolbarModel } from "../useViewportToolbarModel";
import { useFileStore } from "../../stores/fileStore";
import { useUiStore } from "../../stores/uiStore";
import { useViewerStore } from "../../stores/viewerStore";
import type { ToolbarAction, ToolbarItem } from "../../types/ui";

vi.mock("../../viewport/viewportCommands", () => ({
  requestViewportCameraPreset: vi.fn(() => true),
}));

type SidebarModelTestOptions = Parameters<typeof useSidebarModel>[0];

function makeSidebarOptions(): SidebarModelTestOptions {
  return {
    handleCheckForUpdate: vi.fn(() => Promise.resolve()),
    handleInstallUpdate: vi.fn(() => Promise.resolve()),
    handleLoadPayload: vi.fn(() => Promise.resolve()),
    handleOpenDefaultAppsSettings: vi.fn(() => Promise.resolve()),
    handleChangeLanguage: vi.fn(async () => {}),
    handleToggleAutoCheckForUpdates: vi.fn(() => Promise.resolve()),
    handleToggleFileAssociations: vi.fn(() => Promise.resolve()),
    handleToggleOptionalLoaderPack: vi.fn(() => Promise.resolve()),
    handleUnloadPayload: vi.fn(() => Promise.resolve()),
    isCheckingForUpdate: false,
    isInstallingUpdate: false,
    isTauri: false,
    fileAssociationError: null,
    fileAssociationResult: null,
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
  };
}

function findAction(items: ToolbarItem[], id: string): ToolbarAction {
  for (const item of items) {
    if (item.kind === "separator" || item.kind === "status") continue;
    if (item.id === id) return item;
    if (item.children) {
      try {
        return findAction(item.children, id);
      } catch {
        // Continue searching siblings.
      }
    }
  }
  throw new Error(`Toolbar action not found: ${id}`);
}

function SidebarHarness({ children }: { children?: ReactNode }) {
  useSidebarModel(makeSidebarOptions());
  return <aside>{children ?? "sidebar"}</aside>;
}

function ToolbarHarness({ onReady }: { onReady: (run: () => void) => void }) {
  const { viewportToolbarItems } = useViewportToolbarModel();
  onReady(() => {
    findAction(viewportToolbarItems, "camera-front").onRun?.();
  });
  return null;
}

beforeEach(() => {
  useUiStore.setState({
    activeTab: "properties",
    sidebarOpen: true,
    sidebarWidth: 350,
  });
  useFileStore.setState({
    assetInspection: null,
    assetMetadata: null,
    currentFile: null,
    directoryListing: null,
    packFileRequest: null,
    openError: null,
  });
  useViewerStore.setState({
    selectedMeshName: null,
    selectedUsdPrimPath: null,
    showGrid: true,
    showTexture: true,
    showWireframe: false,
    viewerFeedback: {
      mode: "ready",
      message: "Preview ready.",
      warning: null,
      canResetCamera: true,
    },
    viewerSurfaceMode: "asset",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sidebar render isolation", () => {
  it("does not commit the sidebar when a camera preset updates toolbar state", () => {
    let sidebarCommits = 0;
    let runCameraPreset: () => void = () => {
      throw new Error("Toolbar action not initialized");
    };

    render(
      <>
        <Profiler
          id="sidebar"
          onRender={() => {
            sidebarCommits += 1;
          }}
        >
          <SidebarHarness />
        </Profiler>
        <ToolbarHarness
          onReady={(run) => {
            runCameraPreset = run;
          }}
        />
      </>,
    );
    const commitsAfterMount = sidebarCommits;

    act(() => {
      runCameraPreset();
    });

    expect(sidebarCommits).toBe(commitsAfterMount);
  });
});
