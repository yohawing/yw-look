import { ArboristHierarchyTree } from "./ArboristHierarchyTree";
import { useMemo, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import type { AssetMetadata, HierarchyNode, ObjectInfo } from "./assetMetadata";
import { Button } from "./ui/Button";
import { KeyValueRows, type KeyValueRow } from "./ui/KeyValueRows";
import { SidebarListSection } from "./ui/SidebarListSection";
import { SliderNumberField } from "./ui/SliderNumberField";
import "../styles/hierarchy.css";

type HierarchyCardProps = {
  hierarchy: HierarchyNode[];
  objectInfo?: AssetMetadata["objectInfo"];
  morphTargetValues?: Record<string, Record<number, number>>;
  onMorphTargetChange?: (
    selectionKey: string,
    morphTargetIndex: number,
    value: number,
  ) => void;
  /** #33: name of the currently picked mesh (Object3D.name). When the
   * tree contains a node with this name it gets a highlight class and
   * is scrolled into view. `null` clears the selection. */
  selectedName?: string | null;
  /** Identity of the loaded file; used to reset only file-scoped UI state. */
  fileIdentity?: string | null;
  /** #33: invoked when the user clicks a node in the tree. Lets the
   * tree push selections back up to the same `selectedMeshName` state
   * the viewport-picking path drives, so both directions stay in sync.
   * The `null` overload deselects when the user clicks the active row
   * a second time. */
  onSelectName?: (name: string | null) => void;
  /** #28: invoked alongside `onSelectName` with the full SdfPath of the
   * clicked prim (e.g. `"/World/Hero"`). Allows the parent to connect
   * the hierarchy selection to the `UsdPrimPropertyPanel`. `null` is
   * passed when the active row is clicked a second time (deselect). */
  onSelectPrimPath?: (primPath: string | null) => void;
  // ---- #44 per-prim payload session controls --------------------------------
  /**
   * Set of SdfPaths that author a payload arc on this stage (load state
   * irrespective). Only rows whose primPath appears here will show a
   * load/unload button — prevents the controls from leaking onto regular
   * meshes / Xforms that never authored a payload.
   */
  payloadPrimPaths?: ReadonlySet<string>;
  /**
   * Subset of `payloadPrimPaths` that is currently deferred (unloaded) in
   * the active session. Rows in this set show the "Load" button; payload
   * rows not in this set show "Unload".
   */
  unloadedPayloadPaths?: ReadonlySet<string>;
  /**
   * Invoked when the user clicks "Load payload" on a prim row. The parent
   * is responsible for calling `loadPayload` and refreshing the GLB.
   */
  onLoadPayload?: (primPath: string) => void;
  /**
   * Invoked when the user clicks "Unload payload" on a prim row. The
   * parent is responsible for calling `unloadPayload` and refreshing
   * the GLB.
   */
  onUnloadPayload?: (primPath: string) => void;
  renderSelectedObjectDetails?: (objectInfo: ObjectInfo | null) => ReactNode;
  renderMorphTargetMeta?: (
    target: ObjectInfo["morphTargets"][number],
  ) => ReactNode;
};

function clampMorphValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function selectedMorphValue(
  selectedKey: string,
  target: ObjectInfo["morphTargets"][number],
  overrides?: Record<string, Record<number, number>>,
): number {
  return clampMorphValue(
    overrides?.[selectedKey]?.[target.index] ?? target.value,
  );
}

function hierarchyDisplayName(node: HierarchyNode): string {
  return node.displayName || node.name || "(unnamed)";
}

function findSelectedNode(
  nodes: HierarchyNode[],
  key: string | null,
): HierarchyNode | null {
  if (key === null) return null;
  for (const node of nodes) {
    if ((node.primPath ?? node.name) === key) return node;
    const child = findSelectedNode(node.children, key);
    if (child) return child;
  }
  return null;
}

export function HierarchyCard(props: HierarchyCardProps) {
  return (
    <HierarchyCardContent
      key={props.fileIdentity ?? "__no-file__"}
      {...props}
    />
  );
}

function HierarchyCardContent({
  hierarchy,
  objectInfo,
  morphTargetValues,
  onMorphTargetChange,
  selectedName,
  onSelectName,
  onSelectPrimPath,
  payloadPrimPaths,
  unloadedPayloadPaths,
  onLoadPayload,
  onUnloadPayload,
  renderSelectedObjectDetails,
  renderMorphTargetMeta,
}: HierarchyCardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSelected = selectedName ?? null;
  const selectedNode = useMemo(
    () => findSelectedNode(hierarchy, normalizedSelected),
    [hierarchy, normalizedSelected],
  );
  const selectedPath = selectedNode?.primPath ?? normalizedSelected;
  const selectedInfo = normalizedSelected
    ? (objectInfo?.[normalizedSelected] ?? null)
    : null;
  const selectedMorphTargets = selectedInfo?.morphTargets ?? [];
  const selectedChildCount = selectedNode?.children.length ?? 0;
  const selectedPayloadState =
    selectedPath && payloadPrimPaths?.has(selectedPath)
      ? unloadedPayloadPaths?.has(selectedPath)
        ? "Deferred"
        : "Loaded"
      : null;
  const selectedRows: KeyValueRow[] = selectedNode
    ? ([
        {
          id: "name",
          label: "Name",
          value: hierarchyDisplayName(selectedNode),
          mono: true,
        },
        {
          id: "type",
          label: "Type",
          value: selectedNode.kind,
          tone: "muted",
          mono: true,
        },
        selectedPath && {
          id: "path",
          label: "Path",
          value: selectedPath,
          tone: "muted",
          mono: true,
        },
        {
          id: "children",
          label: "Children",
          value: selectedChildCount,
          mono: true,
        },
        selectedPayloadState && {
          id: "payload",
          label: "Payload",
          value: selectedPayloadState,
          mono: true,
        },
        selectedInfo?.vertexCount !== null &&
          selectedInfo?.vertexCount !== undefined && {
            id: "vertices",
            label: "Vertices",
            value: selectedInfo.vertexCount.toLocaleString(),
            mono: true,
          },
        selectedInfo &&
          selectedInfo.materialNames.length > 0 && {
            id: "material",
            label: "Material",
            value: selectedInfo.materialNames.join(", "),
            mono: true,
          },
      ].filter(Boolean) as KeyValueRow[])
    : [];

  return (
    <PanelGroup
      className="hierarchy-card hierarchy-split"
      orientation="vertical"
    >
      <Panel
        className="hierarchy-pane"
        defaultSize={62}
        id="hierarchy-outliner"
        minSize={25}
      >
        <SidebarListSection
          className="hierarchy-section"
          title="Outliner"
          bodyClassName="hierarchy-pane-scroll hierarchy-outliner-body yl-disclosure__body"
          search={{
            ariaLabel: "Filter hierarchy",
            clearLabel: "Clear hierarchy filter",
            onChange: setSearchQuery,
            placeholder: "Search hierarchy",
            value: searchQuery,
          }}
        >
          <ArboristHierarchyTree
            hierarchy={hierarchy}
            searchTerm={searchQuery}
            selectedName={normalizedSelected}
            onSelectName={onSelectName}
            onSelectPrimPath={onSelectPrimPath}
            payloadPrimPaths={payloadPrimPaths}
            unloadedPayloadPaths={unloadedPayloadPaths}
            onLoadPayload={onLoadPayload}
            onUnloadPayload={onUnloadPayload}
          />
        </SidebarListSection>
      </Panel>

      <PanelResizeHandle
        aria-label="Resize outliner details"
        className="hierarchy-resize-handle"
      />

      <Panel
        className="hierarchy-pane"
        defaultSize={38}
        id="hierarchy-selected"
        minSize={20}
      >
        <section className="hierarchy-section yl-disclosure yl-disclosure--section">
          <div className="yl-disclosure__summary">
            <ChevronDownIcon
              className="yl-disclosure__chevron"
              aria-hidden="true"
            />
            <span className="yl-disclosure__title">Selected</span>
          </div>
          <div className="hierarchy-pane-scroll yl-disclosure__body">
            {selectedNode ? (
              <div className="selected-kv">
                <KeyValueRows density="regular" rows={selectedRows} />
                {renderSelectedObjectDetails?.(selectedInfo ?? null)}
                {normalizedSelected && selectedMorphTargets.length > 0 ? (
                  <div className="selected-morph-section">
                    <div className="selected-morph-head">
                      <span>Shape Keys</span>
                      <Button
                        className="u-ml-auto"
                        size="sm"
                        variant="subtle"
                        onClick={() => {
                          for (const target of selectedMorphTargets) {
                            onMorphTargetChange?.(
                              normalizedSelected,
                              target.index,
                              0,
                            );
                          }
                        }}
                      >
                        Reset All
                      </Button>
                    </div>
                    <div className="selected-morph-list">
                      {selectedMorphTargets.map((target) => {
                        const value = selectedMorphValue(
                          normalizedSelected,
                          target,
                          morphTargetValues,
                        );
                        const morphMeta = renderMorphTargetMeta?.(target);
                        return (
                          <div
                            className="selected-morph-row"
                            key={target.index}
                          >
                            <span className="selected-morph-name">
                              {target.name}
                            </span>
                            {morphMeta ? (
                              <span className="selected-morph-meta">
                                {morphMeta}
                              </span>
                            ) : null}
                            <SliderNumberField
                              aria-label={`Shape key ${target.name}`}
                              className="selected-morph-slider-field"
                              max="1"
                              min="0"
                              numberInputAriaLabel={`Shape key ${target.name} value`}
                              onValueChange={(nextValue) =>
                                onMorphTargetChange?.(
                                  normalizedSelected,
                                  target.index,
                                  nextValue,
                                )
                              }
                              precision={2}
                              size="sm"
                              step="0.01"
                              value={value}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="sidebar-empty">
                Select a row to inspect node details.
              </p>
            )}
          </div>
        </section>
      </Panel>
    </PanelGroup>
  );
}
