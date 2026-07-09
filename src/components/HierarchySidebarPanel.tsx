import { useCallback } from "react";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { isUsdFile } from "../lib/files";
import type { StageSessionHandle } from "../lib/usd";
import { useFileStore } from "../stores/fileStore";
import { useViewerStore } from "../stores/viewerStore";
import type { HierarchyNode, ObjectInfo } from "./assetMetadata";
import { HierarchyCard } from "./HierarchyCard";
import { UsdPrimPropertyPanel } from "./UsdPrimPropertyPanel";
import {
  formatPackMorphTargetMeta,
  getPackSelectedObjectDetails,
} from "../packs";
import { KeyValueRows } from "./ui/KeyValueRows";

type HierarchySidebarPanelProps = {
  debugPanelsEnabled?: boolean;
  stageSessionHandle: StageSessionHandle | null;
  payloadPrimPaths: ReadonlySet<string>;
  unloadedPayloadPaths: ReadonlySet<string>;
  onLoadPayload: (primPath: string) => Promise<void>;
  onUnloadPayload: (primPath: string) => Promise<void>;
};

function renderPackSelectedObjectDetails(objectInfo: ObjectInfo | null) {
  const details = getPackSelectedObjectDetails(objectInfo);
  if (!details) return null;
  return (
    <div className="selected-mmd-section">
      <div className="selected-mmd-head">{details.title}</div>
      <KeyValueRows density="regular" rows={details.rows} />
    </div>
  );
}

export function HierarchySidebarPanel({
  debugPanelsEnabled = false,
  stageSessionHandle,
  payloadPrimPaths,
  unloadedPayloadPaths,
  onLoadPayload,
  onUnloadPayload,
}: HierarchySidebarPanelProps) {
  const currentFile = useFileStore((state) => state.currentFile);
  const storeAssetMetadata = useFileStore((state) => state.assetMetadata);
  const morphTargetValues = useViewerStore((state) => state.morphTargetValues);
  const selectedMeshName = useViewerStore((state) => state.selectedMeshName);
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const assetMetadata = useDebugFixtures
    ? debugFixtures.debugPanelMetadata
    : storeAssetMetadata;
  const hierarchy = assetMetadata?.hierarchy ?? EMPTY_HIERARCHY;
  const objectInfo = assetMetadata?.objectInfo;

  const handleMorphTargetChange = useCallback(
    (selectionKey: string, morphTargetIndex: number, value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      const prev = useViewerStore.getState().morphTargetValues;
      useViewerStore.getState().setMorphTargetValues({
        ...prev,
        [selectionKey]: {
          ...(prev[selectionKey] ?? {}),
          [morphTargetIndex]: clamped,
        },
      });
    },
    [],
  );

  const handleSelectPrimPath = useCallback((primPath: string | null) => {
    useViewerStore.getState().setSelectedUsdPrimPath(primPath);
  }, []);

  return (
    <>
      <HierarchyCard
        hierarchy={hierarchy}
        objectInfo={objectInfo}
        morphTargetValues={morphTargetValues}
        onMorphTargetChange={handleMorphTargetChange}
        selectedName={selectedMeshName}
        onSelectName={(name) => {
          useViewerStore.getState().setSelectedMeshName(name);
        }}
        onSelectPrimPath={
          isUsdFile(currentFile) ? handleSelectPrimPath : undefined
        }
        payloadPrimPaths={
          stageSessionHandle !== null ? payloadPrimPaths : undefined
        }
        unloadedPayloadPaths={
          stageSessionHandle !== null ? unloadedPayloadPaths : undefined
        }
        onLoadPayload={stageSessionHandle !== null ? onLoadPayload : undefined}
        onUnloadPayload={
          stageSessionHandle !== null ? onUnloadPayload : undefined
        }
        renderSelectedObjectDetails={renderPackSelectedObjectDetails}
        renderMorphTargetMeta={formatPackMorphTargetMeta}
      />
      {isUsdFile(currentFile) && (
        <UsdPrimPropertyPanel path={currentFile?.path ?? null} />
      )}
    </>
  );
}

const EMPTY_HIERARCHY: HierarchyNode[] = [];
