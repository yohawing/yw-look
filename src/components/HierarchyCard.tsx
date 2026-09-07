import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  DotFilledIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import type { AssetMetadata, HierarchyNode, ObjectInfo } from "./assetMetadata";
import { Button } from "./ui/Button";
import { KeyValueRows, type KeyValueRow } from "./ui/KeyValueRows";
import { ListTextFilter } from "./ui/ListTextFilter";
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

type DisplayHierarchyNode = {
  children: DisplayHierarchyNode[];
  key: string;
  node: HierarchyNode;
};

function buildDisplayHierarchy(
  nodes: HierarchyNode[],
  parentIndexPath: readonly number[] = [],
): DisplayHierarchyNode[] {
  return nodes.map((node, index) => {
    const indexPath = [...parentIndexPath, index];
    const key = `hierarchy-${indexPath.join(".")}`;
    return {
      children: buildDisplayHierarchy(node.children, indexPath),
      key,
      node,
    };
  });
}

function filterDisplayHierarchy(
  nodes: DisplayHierarchyNode[],
  normalizedSearch: string,
): DisplayHierarchyNode[] {
  if (normalizedSearch.length === 0) return nodes;

  return nodes.flatMap((displayNode) => {
    const children = filterDisplayHierarchy(
      displayNode.children,
      normalizedSearch,
    );
    const matches = hierarchyDisplayName(displayNode.node)
      .toLocaleLowerCase()
      .includes(normalizedSearch);
    return matches || children.length > 0 ? [{ ...displayNode, children }] : [];
  });
}

function collectFilterExpandedKeys(
  nodes: DisplayHierarchyNode[],
  expandedKeys: Set<string>,
) {
  for (const displayNode of nodes) {
    if (displayNode.children.length > 0) {
      expandedKeys.add(displayNode.key);
      collectFilterExpandedKeys(displayNode.children, expandedKeys);
    }
  }
}

function HierarchyBranch({
  displayNode,
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
  expandedKeys,
  onToggleExpanded,
  filterExpandedKeys,
}: {
  displayNode: DisplayHierarchyNode;
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
  expandedKeys: Readonly<Record<string, boolean>>;
  onToggleExpanded: (key: string, defaultExpanded: boolean) => void;
  filterExpandedKeys: ReadonlySet<string>;
}) {
  const { node } = displayNode;
  const hasChildren = displayNode.children.length > 0;
  const expanded = expandedKeys[displayNode.key] ?? depth < 2;
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
  const showChildren =
    hasChildren &&
    (expanded || forceExpanded || filterExpandedKeys.has(displayNode.key));
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
          // into a USD prim path passed to the native backend.
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
              onToggleExpanded(displayNode.key, depth < 2);
            }}
            disabled={filterExpandedKeys.has(displayNode.key)}
            type="button"
            aria-label={showChildren ? "Collapse" : "Expand"}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={showChildren ? "tree-chevron-open" : ""}
            />
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
            <CircleIcon aria-hidden="true" />
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
            <DotFilledIcon aria-hidden="true" />
          </button>
        )}
      </div>
      {showChildren ? (
        <ul className="tree-children">
          {displayNode.children.map((child) => (
            <HierarchyBranch
              key={child.key}
              displayNode={child}
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
                child.node.primPath ?? child.node.name,
              )}
              forceExpandedKeys={forceExpandedKeys}
              selectedRef={selectedRef}
              payloadPrimPaths={payloadPrimPaths}
              unloadedPayloadPaths={unloadedPayloadPaths}
              onLoadPayload={onLoadPayload}
              onUnloadPayload={onUnloadPayload}
              expandedKeys={expandedKeys}
              onToggleExpanded={onToggleExpanded}
              filterExpandedKeys={filterExpandedKeys}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type HierarchyStats = {
  selectedNode: HierarchyNode | null;
  selectedAncestorKeys: ReadonlySet<string>;
};

function collectHierarchyStats(
  nodes: HierarchyNode[],
  selectedKey: string | null,
): HierarchyStats {
  let selectedNode: HierarchyNode | null = null;
  let selectedPathKeys: string[] | null = null;
  const ancestorStack: string[] = [];

  const visit = (node: HierarchyNode) => {
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
    selectedNode,
    selectedAncestorKeys: new Set(selectedPathKeys ?? []),
  };
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
  const selectedRef = useRef<HTMLLIElement | null>(null);
  const searchHeaderRef = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    searchHeaderRef.current?.querySelector("button")?.focus();
  };
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

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
  const { selectedAncestorKeys, selectedNode } = useMemo(
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

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const displayHierarchy = useMemo(
    () => buildDisplayHierarchy(hierarchy),
    [hierarchy],
  );
  const filteredDisplayHierarchy = useMemo(
    () => filterDisplayHierarchy(displayHierarchy, normalizedSearch),
    [displayHierarchy, normalizedSearch],
  );
  const filterExpandedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (normalizedSearch.length > 0) {
      collectFilterExpandedKeys(filteredDisplayHierarchy, keys);
    }
    return keys;
  }, [filteredDisplayHierarchy, normalizedSearch]);
  const handleToggleExpanded = (key: string, defaultExpanded: boolean) => {
    setExpandedKeys((current) => ({
      ...current,
      [key]: !(current[key] ?? defaultExpanded),
    }));
  };

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
        <section
          className="hierarchy-section yl-disclosure yl-disclosure--section"
          onKeyDown={(event) => {
            if (
              searchOpen &&
              event.key === "Escape" &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.stopPropagation();
              closeSearch();
            }
          }}
        >
          <div className="yl-disclosure__summary" ref={searchHeaderRef}>
            <ChevronDownIcon
              className="yl-disclosure__chevron"
              aria-hidden="true"
            />
            <span className="yl-disclosure__title">Outliner</span>
            <Button
              aria-label="Search hierarchy"
              title="Search hierarchy"
              aria-expanded={searchOpen}
              aria-controls={searchOpen ? searchId : undefined}
              aria-pressed={searchOpen}
              className="hierarchy-search-toggle"
              iconOnly
              size="sm"
              variant="ghost"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            >
              <MagnifyingGlassIcon aria-hidden="true" />
            </Button>
          </div>
          <div className="hierarchy-pane-scroll hierarchy-outliner-body yl-disclosure__body">
            {searchOpen ? (
              <ListTextFilter
                id={searchId}
                autoFocus
                ariaLabel="Filter hierarchy"
                clearLabel="Clear hierarchy filter"
                onChange={setSearchQuery}
                placeholder="Search hierarchy"
                value={searchQuery}
              />
            ) : null}
            <div className="hierarchy-tree-scroll">
              {hierarchy.length === 0 ? (
                <p className="sidebar-empty">
                  No hierarchy available for the current asset.
                </p>
              ) : filteredDisplayHierarchy.length === 0 ? (
                <p className="sidebar-empty">No hierarchy nodes match.</p>
              ) : (
                <ul className="tree-root">
                  {filteredDisplayHierarchy.map((displayNode) => (
                    <HierarchyBranch
                      key={displayNode.key}
                      displayNode={displayNode}
                      depth={0}
                      selectedName={normalizedSelected}
                      onSelectName={onSelectName}
                      onSelectPrimPath={onSelectPrimPath}
                      parentPath="/"
                      forceExpanded={
                        normalizedSelected !== null &&
                        selectedAncestorKeys.has(
                          displayNode.node.primPath ?? displayNode.node.name,
                        )
                      }
                      forceExpandedKeys={selectedAncestorKeys}
                      selectedRef={selectedRef}
                      payloadPrimPaths={payloadPrimPaths}
                      unloadedPayloadPaths={unloadedPayloadPaths}
                      onLoadPayload={onLoadPayload}
                      onUnloadPayload={onUnloadPayload}
                      expandedKeys={expandedKeys}
                      onToggleExpanded={handleToggleExpanded}
                      filterExpandedKeys={filterExpandedKeys}
                    />
                  ))}
                </ul>
              )}
            </div>
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
