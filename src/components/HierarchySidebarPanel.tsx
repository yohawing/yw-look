import { buildIfcHierarchy } from "../lib/ifcHierarchy";
import { useCallback, useMemo } from "react";
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
  renderMetadataCardForPackMetadata,
} from "../packs";
import { KeyValueRows } from "./ui/KeyValueRows";
import { mergeKnownPayloadRoots } from "./usdPayloadHierarchy";

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
  const packMetadata = useFileStore((state) => state.packMetadata);
  const ifcHierarchy = useMemo(
    () =>
      packMetadata?.kind === "ifc"
        ? buildIfcHierarchy(packMetadata.inspection.getSnapshot().elements)
        : null,
    [packMetadata],
  );
  const morphTargetValues = useViewerStore((state) => state.morphTargetValues);
  const selectedMeshName = useViewerStore((state) => state.selectedMeshName);
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const assetMetadata = useDebugFixtures
    ? debugFixtures.debugPanelMetadata
    : storeAssetMetadata;
  const hierarchy =
    (!useDebugFixtures && ifcHierarchy) ||
    assetMetadata?.hierarchy ||
    EMPTY_HIERARCHY;
  const objectInfo = assetMetadata?.objectInfo;
  const payloadSessionEnabled =
    !useDebugFixtures && isUsdFile(currentFile) && stageSessionHandle !== null;
  const displayHierarchy = useMemo(
    () =>
      payloadSessionEnabled
        ? mergeKnownPayloadRoots(hierarchy, payloadPrimPaths)
        : hierarchy,
    [hierarchy, payloadPrimPaths, payloadSessionEnabled],
  );

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
        hierarchy={displayHierarchy}
        fileIdentity={currentFile?.path ?? null}
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
        payloadPrimPaths={payloadSessionEnabled ? payloadPrimPaths : undefined}
        unloadedPayloadPaths={
          payloadSessionEnabled ? unloadedPayloadPaths : undefined
        }
        onLoadPayload={payloadSessionEnabled ? onLoadPayload : undefined}
        onUnloadPayload={payloadSessionEnabled ? onUnloadPayload : undefined}
        renderSelectedObjectDetails={(info) => (
          <>
            {!useDebugFixtures && packMetadata?.kind === "ifc"
              ? renderMetadataCardForPackMetadata(packMetadata, {
                  view: "selection",
                  selectedKey: selectedMeshName,
                  onSelect: useViewerStore.getState().setSelectedMeshName,
                })
              : renderPackSelectedObjectDetails(info)}
            {isUsdFile(currentFile) ? (
              <UsdPrimPropertyPanel embedded path={currentFile?.path ?? null} />
            ) : null}
          </>
        )}
        renderMorphTargetMeta={formatPackMorphTargetMeta}
        selectedTransformNote={
          isUsdFile(currentFile)
            ? "Preview local values · not USD authored"
            : "Preview local values"
        }
      />
    </>
  );
}

const EMPTY_HIERARCHY: HierarchyNode[] = [];
