import { buildIfcHierarchy } from "../lib/ifcHierarchy";
import { t, useLocale } from "../lib/i18n";
import { SidebarSection } from "../lib/sidebarPrimitives";
import { useCallback, useMemo } from "react";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { isUsdFile } from "../lib/files";
import type { StageSessionHandle, StageInspection } from "../lib/usd";
import { useFileStore } from "../stores/fileStore";
import { useViewerStore } from "../stores/viewerStore";
import { useUiStore } from "../stores/uiStore";
import type { HierarchyNode, ObjectInfo } from "./assetMetadata";
import { HierarchyCard } from "./HierarchyCard";
import { UsdSelectedSources } from "./UsdSelectedSources";
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
  inspection?: StageInspection | null;
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
  inspection = null,
  payloadPrimPaths,
  unloadedPayloadPaths,
  onLoadPayload,
  onUnloadPayload,
}: HierarchySidebarPanelProps) {
  useLocale();
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
  const ifcElementId = /^ifc:(\d+)$/.exec(selectedMeshName ?? "")?.[1];
  const ifcMaterials =
    packMetadata?.kind === "ifc" ? packMetadata.inspection.materials : null;
  const selectedIfcMaterials =
    ifcElementId && ifcMaterials
      ? [
          ...ifcMaterials.building,
          ...ifcMaterials.display.filter((entry) => entry.origin === "source"),
        ].filter((entry) => entry.elementIds.includes(Number(ifcElementId)))
      : [];
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

  const handleSelectMaterial = useCallback((materialId: string) => {
    useViewerStore.getState().requestMaterialNavigation(materialId);
    useUiStore.getState().setActiveTab("materials");
    useUiStore.getState().setSidebarOpen(true);
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
        onSelectMaterial={handleSelectMaterial}
        payloadPrimPaths={payloadSessionEnabled ? payloadPrimPaths : undefined}
        unloadedPayloadPaths={
          payloadSessionEnabled ? unloadedPayloadPaths : undefined
        }
        onLoadPayload={payloadSessionEnabled ? onLoadPayload : undefined}
        onUnloadPayload={payloadSessionEnabled ? onUnloadPayload : undefined}
        renderSelectedObjectDetails={(info, primPath) => (
          <>
            {!useDebugFixtures && selectedIfcMaterials.length > 0 ? (
              <SidebarSection title={t("materials")}>
                <span className="selected-material-links">
                  {selectedIfcMaterials.map((material) => (
                    <button
                      type="button"
                      className="selected-material-link"
                      key={material.id}
                      onClick={() => handleSelectMaterial(material.id)}
                      title={material.id}
                    >
                      {material.name}
                    </button>
                  ))}
                </span>
              </SidebarSection>
            ) : null}
            {!useDebugFixtures && packMetadata?.kind === "ifc"
              ? renderMetadataCardForPackMetadata(packMetadata, {
                  view: "selection",
                  selectedKey: selectedMeshName,
                  onSelect: useViewerStore.getState().setSelectedMeshName,
                })
              : renderPackSelectedObjectDetails(info)}
            {isUsdFile(currentFile) ? (
              <>
                <UsdSelectedSources
                  inspection={
                    inspection?.path === currentFile?.path ? inspection : null
                  }
                  primPath={primPath}
                  payloadLoaded={
                    payloadSessionEnabled &&
                    primPath !== null &&
                    payloadPrimPaths.has(primPath)
                      ? !unloadedPayloadPaths.has(primPath)
                      : undefined
                  }
                />
                <UsdPrimPropertyPanel
                  embedded
                  path={currentFile?.path ?? null}
                />
              </>
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
