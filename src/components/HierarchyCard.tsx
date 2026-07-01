import { useEffect, useMemo, useRef, useState } from "react";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import type {
  AssetMetadata,
  HierarchyNode,
  MmdBoneEntry,
  ObjectInfo,
} from "./assetMetadata";
import { Button } from "./ui/Button";
import { KeyValueRows, type KeyValueRow } from "./ui/KeyValueRows";
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

function fmtMmdNumber(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function fmtMmdVec(value: readonly number[] | null): string {
  return value ? value.map(fmtMmdNumber).join(", ") : "none";
}

function fmtMmdFlags(flags: Record<string, boolean> | null): string {
  if (!flags) return "none";
  const enabled = Object.entries(flags)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  return enabled.length > 0 ? enabled.join(", ") : "none";
}

function hierarchyDisplayName(node: HierarchyNode): string {
  return node.displayName || node.name || "(unnamed)";
}

function fmtMmdMorphOffsets(
  mmd: ObjectInfo["morphTargets"][number]["mmd"],
): string {
  if (!mmd) return "";
  const parts = [
    mmd.boneOffsetCount > 0 ? `bone:${mmd.boneOffsetCount}` : null,
    mmd.groupOffsetCount > 0 ? `group:${mmd.groupOffsetCount}` : null,
    mmd.flipOffsetCount > 0 ? `flip:${mmd.flipOffsetCount}` : null,
    mmd.impulseOffsetCount > 0 ? `impulse:${mmd.impulseOffsetCount}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : "offsets:none";
}

function SelectedMmdBone({ bone }: { bone: MmdBoneEntry | null }) {
  if (!bone) return null;

  const rows: KeyValueRow[] = [
    bone.boneIndex !== null && {
      id: "index",
      label: "Index",
      value: bone.boneIndex,
      mono: true,
    },
    bone.name && {
      id: "mmd-name",
      label: "MMD Name",
      value: bone.name,
      mono: true,
    },
    bone.englishName &&
      bone.englishName !== bone.name && {
        id: "english",
        label: "English",
        value: bone.englishName,
        tone: "muted",
        mono: true,
      },
    {
      id: "parent",
      label: "Parent",
      value:
        bone.parentIndex !== null && bone.parentIndex >= 0
          ? `${bone.parentIndex}${bone.parentName ? ` · ${bone.parentName}` : ""}`
          : "none",
      tone: "muted",
      mono: true,
    },
    {
      id: "rest-pos",
      label: "Rest Pos",
      value: fmtMmdVec(bone.restPosition),
      mono: true,
    },
    bone.layer !== null && {
      id: "layer",
      label: "Layer",
      value: bone.layer,
      mono: true,
    },
    bone.appendTransform && {
      id: "append",
      label: "Append",
      value: `${bone.appendTransform.parentIndex}${
        bone.appendTransform.parentName
          ? ` · ${bone.appendTransform.parentName}`
          : ""
      } x${fmtMmdNumber(bone.appendTransform.weight)}`,
      mono: true,
    },
    {
      id: "flags",
      label: "Flags",
      value: fmtMmdFlags(bone.flags),
      mono: true,
    },
    bone.ik && {
      id: "ik-role",
      label: "IK Role",
      value: bone.ik.roles.join(", "),
      mono: true,
    },
    bone.ik && {
      id: "ik-chain",
      label: "IK Chain",
      value: `goal:${bone.ik.goalBoneIndex ?? "?"} target:${
        bone.ik.effectorBoneIndex ?? "?"
      } links:${bone.ik.linkCount ?? "?"}`,
      mono: true,
    },
    bone.ik &&
      (bone.ik.iterationCount !== null ||
        bone.ik.maxAnglePerIteration !== null) && {
        id: "ik-solve",
        label: "IK Solve",
        value: `iter:${bone.ik.iterationCount ?? "?"} angle:${
          bone.ik.maxAnglePerIteration !== null
            ? fmtMmdNumber(bone.ik.maxAnglePerIteration)
            : "?"
        }`,
        mono: true,
      },
    bone.ik &&
      bone.ik.limitKinds.length > 0 && {
        id: "ik-limits",
        label: "IK Limits",
        value: bone.ik.limitKinds.join(", "),
        mono: true,
      },
  ].filter(Boolean) as KeyValueRow[];

  return (
    <div className="selected-mmd-section">
      <div className="selected-mmd-head">MMD Bone</div>
      <KeyValueRows density="regular" rows={rows} />
    </div>
  );
}

function HierarchyBranch({
  node,
  depth,
  selectedName,
  onSelectName,
  onSelectPrimPath,
  parentPath,
  forceExpanded,
  forceExpandedKeys,
  selectedRef,
  payloadPrimPaths,
  unloadedPayloadPaths,
  onLoadPayload,
  onUnloadPayload,
}: {
  node: HierarchyNode;
  depth: number;
  selectedName: string | null;
  onSelectName?: (name: string | null) => void;
  onSelectPrimPath?: (primPath: string | null) => void;
  /** Accumulated SdfPath prefix of the parent node (e.g. `"/World"`). */
  parentPath: string;
  forceExpanded: boolean;
  forceExpandedKeys: ReadonlySet<string>;
  selectedRef: React.RefObject<HTMLLIElement | null>;
  payloadPrimPaths?: ReadonlySet<string>;
  unloadedPayloadPaths?: ReadonlySet<string>;
  onLoadPayload?: (primPath: string) => void;
  onUnloadPayload?: (primPath: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(depth < 2);
  // #46: stable selection key — prefer the SdfPath stored in node.primPath
  // (emitted by the hierarchy-aware GLB pipeline) so that selections
  // survive node-name changes and stay consistent across the viewport
  // picking path.  Falls back to node.name for non-USD assets.
  const nodeSelectionKey = node.primPath ?? node.name;
  const isSelected = selectedName !== null && nodeSelectionKey === selectedName;
  // When the picker selects something deep in the tree we need to
  // force-open every ancestor so the row is actually visible. We pass
  // `forceExpanded` from above and OR it into the local state instead
  // of overwriting it, so once the user collapses something
  // re-selecting the same prim doesn't snap their layout back open.
  const showChildren = hasChildren && (expanded || forceExpanded);
  // Build the full SdfPath for this node for the onSelectPrimPath callback.
  // #46: when node.primPath is present we use it directly — it is the
  // authoritative SdfPath from the GLB extras and needs no reconstruction.
  // For non-USD assets we still reconstruct from parentPath + name.
  const primPath = node.primPath
    ? node.primPath
    : !node.name
      ? parentPath
      : node.name.startsWith("/")
        ? node.name
        : `${parentPath === "/" ? "" : parentPath}/${node.name}`;

  // #44: determine payload status for this prim.
  // A row only shows a load/unload button when the parent has both wired up
  // session callbacks AND identified this primPath as authoring a payload
  // arc (`payloadPrimPaths`). Without that gate every regular mesh / Xform
  // would expose an unload button and clicking it would issue bogus backend
  // unloads. Within the payload set, the unloaded subset gets the load
  // button and the loaded remainder gets the unload button.
  const isPayloadSource =
    !!primPath && !!payloadPrimPaths && payloadPrimPaths.has(primPath);
  const isUnloadedPayload =
    isPayloadSource &&
    !!unloadedPayloadPaths &&
    unloadedPayloadPaths.has(primPath);
  const isLoadedPayload = isPayloadSource && !isUnloadedPayload;

  return (
    <li
      className={`tree-item${isSelected ? " is-selected" : ""}`}
      ref={isSelected ? selectedRef : undefined}
    >
      <div
        className={`tree-row${isSelected ? " is-selected" : ""}${
          onSelectName && node.name ? " is-clickable" : ""
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={
          // Unnamed nodes (e.g. anonymous Three.js wrappers) have no
          // stable selection key, so skip the click rather than letting
          // every unnamed row share the empty-string identity. This
          // also prevents `(unnamed)` (the display label) from leaking
          // into a USD prim path passed to the C++ backend.
          onSelectName && node.name
            ? (event) => {
                event.stopPropagation();
                // #46: pass the stable selection key (primPath when present,
                // node.name for non-USD assets) so the viewport highlight and
                // the hierarchy selection stay in sync regardless of which
                // direction drives the change.
                const nextKey = isSelected ? null : nodeSelectionKey;
                onSelectName(nextKey);
                onSelectPrimPath?.(isSelected ? null : primPath);
              }
            : undefined
        }
      >
        {hasChildren ? (
          <button
            className="tree-chevron"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((v) => !v);
            }}
            type="button"
            aria-label={showChildren ? "Collapse" : "Expand"}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              className={showChildren ? "tree-chevron-open" : ""}
            >
              <path
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="tree-chevron-spacer" />
        )}
        <span className="tree-node-name">{hierarchyDisplayName(node)}</span>
        <span className="tree-node-kind">{node.kind}</span>
        {/* #44: per-prim payload load/unload button — only shown when a
            session is active (callbacks provided) and this prim is a known
            payload source (its primPath is tracked by the parent). */}
        {isUnloadedPayload && onLoadPayload && (
          <button
            className="tree-payload-btn tree-payload-btn--unloaded"
            aria-label="Load payload"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLoadPayload(primPath);
            }}
          >
            {/* Hollow circle — payload deferred */}
            <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
              <circle
                cx="5"
                cy="5"
                r="4"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        )}
        {isLoadedPayload && onUnloadPayload && (
          <button
            className="tree-payload-btn tree-payload-btn--loaded"
            aria-label="Unload payload"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnloadPayload(primPath);
            }}
          >
            {/* Solid circle — payload loaded */}
            <svg viewBox="0 0 10 10" width="10" height="10">
              <circle cx="5" cy="5" r="4" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
      {showChildren ? (
        <ul className="tree-children">
          {node.children.map((child, index) => (
            <HierarchyBranch
              key={`${node.name}-${child.name}-${index}`}
              node={child}
              depth={depth + 1}
              selectedName={selectedName}
              onSelectName={onSelectName}
              onSelectPrimPath={onSelectPrimPath}
              parentPath={primPath}
              // Each child decides force-open from its own subtree only.
              // Inheriting the parent's expanded state would
              // unfold every sibling once a single deep node is
              // selected; the chain we actually want to open is just
              // the ancestor path of the selection.
              forceExpanded={forceExpandedKeys.has(
                child.primPath ?? child.name,
              )}
              forceExpandedKeys={forceExpandedKeys}
              selectedRef={selectedRef}
              payloadPrimPaths={payloadPrimPaths}
              unloadedPayloadPaths={unloadedPayloadPaths}
              onLoadPayload={onLoadPayload}
              onUnloadPayload={onUnloadPayload}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type HierarchyStats = {
  totalNodeCount: number;
  selectedNode: HierarchyNode | null;
  selectedAncestorKeys: ReadonlySet<string>;
};

function collectHierarchyStats(
  nodes: HierarchyNode[],
  selectedKey: string | null,
): HierarchyStats {
  let totalNodeCount = 0;
  let selectedNode: HierarchyNode | null = null;
  let selectedPathKeys: string[] | null = null;
  const ancestorStack: string[] = [];

  const visit = (node: HierarchyNode) => {
    totalNodeCount += 1;

    const nodeKey = node.primPath ?? node.name;
    if (selectedKey !== null && nodeKey === selectedKey && !selectedNode) {
      selectedNode = node;
      selectedPathKeys = [...ancestorStack];
    }

    ancestorStack.push(nodeKey);
    for (const child of node.children) {
      visit(child);
    }
    ancestorStack.pop();
  };

  for (const node of nodes) {
    visit(node);
  }

  return {
    totalNodeCount,
    selectedNode,
    selectedAncestorKeys: new Set(selectedPathKeys ?? []),
  };
}

export function HierarchyCard({
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
}: HierarchyCardProps) {
  const selectedRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!selectedName) return;
    const el = selectedRef.current;
    if (!el) return;
    // `nearest` keeps an already-visible row from jumping; the tree
    // only auto-scrolls when the picked node would otherwise be off
    // screen. Smooth scroll is intentional — instant jumps make it
    // hard to follow which row was selected when the tree is dense.
    // jsdom doesn't implement scrollIntoView, so we guard the call.
    el.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [selectedName]);

  const normalizedSelected = selectedName ?? null;
  const { selectedAncestorKeys, selectedNode, totalNodeCount } = useMemo(
    () => collectHierarchyStats(hierarchy, normalizedSelected),
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
        <section className="hierarchy-section">
          <div className="sec-head">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              className="sec-head-chevron"
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Outliner</span>
            <span className="sec-head-count">{totalNodeCount}</span>
          </div>
          <div className="hierarchy-pane-scroll">
            {hierarchy.length > 0 ? (
              <ul className="tree-root">
                {hierarchy.map((node, index) => (
                  <HierarchyBranch
                    key={`${node.name}-${index}`}
                    node={node}
                    depth={0}
                    selectedName={normalizedSelected}
                    onSelectName={onSelectName}
                    onSelectPrimPath={onSelectPrimPath}
                    parentPath="/"
                    forceExpanded={
                      normalizedSelected !== null &&
                      selectedAncestorKeys.has(node.primPath ?? node.name)
                    }
                    forceExpandedKeys={selectedAncestorKeys}
                    selectedRef={selectedRef}
                    payloadPrimPaths={payloadPrimPaths}
                    unloadedPayloadPaths={unloadedPayloadPaths}
                    onLoadPayload={onLoadPayload}
                    onUnloadPayload={onUnloadPayload}
                  />
                ))}
              </ul>
            ) : (
              <p className="sidebar-empty">
                No hierarchy available for the current asset.
              </p>
            )}
          </div>
        </section>
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
        <section className="hierarchy-section">
          <div className="sec-head">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              className="sec-head-chevron"
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Selected</span>
          </div>
          <div className="hierarchy-pane-scroll">
            {selectedNode ? (
              <div className="selected-kv">
                <KeyValueRows density="regular" rows={selectedRows} />
                <SelectedMmdBone bone={selectedInfo?.mmdBone ?? null} />
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
                        return (
                          <label
                            className="selected-morph-row"
                            key={target.index}
                          >
                            <span className="selected-morph-name">
                              {target.name}
                            </span>
                            <span className="selected-morph-value">
                              {value.toFixed(2)}
                            </span>
                            {target.mmd ? (
                              <span className="selected-morph-meta">
                                {target.mmd.type ?? "mmd"} ·{" "}
                                {target.mmd.englishName &&
                                target.mmd.englishName !== target.name
                                  ? `${target.mmd.englishName} · `
                                  : ""}
                                {fmtMmdMorphOffsets(target.mmd)}
                              </span>
                            ) : null}
                            <input
                              aria-label={`Shape key ${target.name}`}
                              className="selected-morph-slider"
                              max="1"
                              min="0"
                              step="0.01"
                              type="range"
                              value={value}
                              onChange={(event) =>
                                onMorphTargetChange?.(
                                  normalizedSelected,
                                  target.index,
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </label>
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
