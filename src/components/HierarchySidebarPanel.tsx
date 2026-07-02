import { useCallback } from "react";
import { isUsdFile, type SelectedFile } from "../lib/files";
import type { StageSessionHandle } from "../lib/usd";
import { useViewerStore } from "../stores/viewerStore";
import type { AssetMetadata, HierarchyNode } from "./assetMetadata";
import { HierarchyCard } from "./HierarchyCard";
import { UsdPrimPropertyPanel } from "./UsdPrimPropertyPanel";

type HierarchySidebarPanelProps = {
  currentFile: SelectedFile | null;
  hierarchy: HierarchyNode[];
  objectInfo?: AssetMetadata["objectInfo"];
  stageSessionHandle: StageSessionHandle | null;
  payloadPrimPaths: ReadonlySet<string>;
  unloadedPayloadPaths: ReadonlySet<string>;
  onLoadPayload: (primPath: string) => Promise<void>;
  onUnloadPayload: (primPath: string) => Promise<void>;
};

export function HierarchySidebarPanel({
  currentFile,
  hierarchy,
  objectInfo,
  stageSessionHandle,
  payloadPrimPaths,
  unloadedPayloadPaths,
  onLoadPayload,
  onUnloadPayload,
}: HierarchySidebarPanelProps) {
  const morphTargetValues = useViewerStore((state) => state.morphTargetValues);
  const selectedMeshName = useViewerStore((state) => state.selectedMeshName);

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
      />
      {isUsdFile(currentFile) && (
        <UsdPrimPropertyPanel path={currentFile?.path ?? null} />
      )}
    </>
  );
}
