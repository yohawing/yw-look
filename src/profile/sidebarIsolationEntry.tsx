/* eslint-disable react-refresh/only-export-components */
import React, {
  Profiler,
  useEffect,
  useRef,
  type ProfilerOnRenderCallback,
} from "react";
import ReactDOM from "react-dom/client";
import { useSidebarModel } from "../app/useSidebarModel";
import { useViewportToolbarModel } from "../app/useViewportToolbarModel";
import { useFileStore } from "../stores/fileStore";
import { useUiStore } from "../stores/uiStore";
import { useViewerStore } from "../stores/viewerStore";
import type { ToolbarAction, ToolbarItem } from "../types/ui";
import { registerViewportCommandHandlers } from "../viewport/viewportCommands";

type SidebarModelOptions = Parameters<typeof useSidebarModel>[0];

type CommitRecord = {
  actualDuration: number;
  baseDuration: number;
  commitTime: number;
  phase: "mount" | "nested-update" | "update";
  startTime: number;
};

type SidebarProfileResult = {
  commitsAfterMount: number;
  commitsAfterCameraPreset: number;
  passed: boolean;
  records: CommitRecord[];
};

function makeSidebarOptions(): SidebarModelOptions {
  return {
    handleCheckForUpdate: () => Promise.resolve(),
    handleInstallUpdate: () => Promise.resolve(),
    handleLoadPayload: () => Promise.resolve(),
    handleChangeLanguage: async () => {},
    handleToggleAutoCheckForUpdates: () => Promise.resolve(),
    handleToggleOptionalLoaderPack: () => Promise.resolve(),
    handleUnloadPayload: () => Promise.resolve(),
    isCheckingForUpdate: false,
    isInstallingUpdate: false,
    isTauri: false,
    optionalLoaderManifests: [],
    optionalLoaderManifestsError: null,
    payloadPrimPaths: new Set<string>(),
    performSelectFilePath: () => Promise.resolve(),
    recentFilesError: null,
    recentFilesPayload: null,
    sessionAdjustedUsdSummary: null,
    setRecentFilesError: () => undefined,
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
        // Keep scanning sibling groups.
      }
    }
  }
  throw new Error(`Toolbar action not found: ${id}`);
}

function SidebarHarness() {
  useSidebarModel(makeSidebarOptions());
  return <aside data-testid="sidebar-profile-sidebar">sidebar</aside>;
}

function ToolbarHarness({ onRun }: { onRun: () => void }) {
  const didRunRef = useRef(false);
  const { viewportToolbarItems } = useViewportToolbarModel();

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;
    const action = findAction(viewportToolbarItems, "camera-front");
    action.onRun?.();
    onRun();
  }, [onRun, viewportToolbarItems]);

  return null;
}

function publishResult(result: SidebarProfileResult) {
  Object.assign(window, {
    __YW_SIDEBAR_PROFILE_RESULT__: result,
  });
}

function resetStores() {
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
    openError: null,
    packFileRequest: null,
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
}

function SidebarProfileHarness() {
  const recordsRef = useRef<CommitRecord[]>([]);

  const onRender: ProfilerOnRenderCallback = (
    _id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    recordsRef.current.push({
      actualDuration,
      baseDuration,
      commitTime,
      phase,
      startTime,
    });
  };

  const handleToolbarRun = () => {
    window.requestAnimationFrame(() => {
      const records = recordsRef.current;
      const commitsAfterMount = records.filter(
        (record) => record.phase === "mount",
      ).length;
      const result = {
        commitsAfterMount,
        commitsAfterCameraPreset: records.length,
        passed: records.length === commitsAfterMount,
        records,
      };
      publishResult(result);
    });
  };

  return (
    <>
      <Profiler id="sidebar" onRender={onRender}>
        <SidebarHarness />
      </Profiler>
      <ToolbarHarness onRun={handleToolbarRun} />
    </>
  );
}

resetStores();
const unregisterViewportCommands = registerViewportCommandHandlers({
  applyCameraPreset: () => true,
});

window.addEventListener(
  "beforeunload",
  () => {
    unregisterViewportCommands();
  },
  { once: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <SidebarProfileHarness />,
);
