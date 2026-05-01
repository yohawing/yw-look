import { useEffect, useRef, useState } from "react";
import type { HierarchyNode } from "./assetMetadata";

type HierarchyCardProps = {
  hierarchy: HierarchyNode[];
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

function HierarchyBranch({
  node,
  depth,
  selectedName,
  onSelectName,
  onSelectPrimPath,
  parentPath,
  forceExpanded,
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
        <span className="tree-node-name">{node.name || "(unnamed)"}</span>
        <span className="tree-node-kind">{node.kind}</span>
        {/* #44: per-prim payload load/unload button — only shown when a
            session is active (callbacks provided) and this prim is a known
            payload source (its primPath is tracked by the parent). */}
        {isUnloadedPayload && onLoadPayload && (
          <button
            className="tree-payload-btn tree-payload-btn--unloaded"
            title={`Load payload at ${primPath}`}
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
            title={`Unload payload at ${primPath}`}
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
              // Inheriting `forceExpanded` from the parent would
              // unfold every sibling once a single deep node is
              // selected; the chain we actually want to open is just
              // the ancestor path of the selection.
              forceExpanded={
                selectedName !== null && hasDescendant(child, selectedName)
              }
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

/** Walks the subtree rooted at `node` looking for a descendant whose
 * selection key (primPath when present, name otherwise) matches `key`.
 * Used to decide whether to force-open an ancestor branch so the
 * selected row is visible without the user clicking through.
 * We do not memoize because the hierarchy is small (USD prim counts in
 * the thousands at most) and selection changes rarely. */
function hasDescendant(node: HierarchyNode, key: string): boolean {
  const nodeKey = node.primPath ?? node.name;
  if (nodeKey === key) return true;
  return node.children.some((child) => hasDescendant(child, key));
}

function findNodeByKey(
  nodes: HierarchyNode[],
  key: string | null,
): HierarchyNode | null {
  if (!key) return null;
  for (const node of nodes) {
    const nodeKey = node.primPath ?? node.name;
    if (nodeKey === key) return node;
    const child = findNodeByKey(node.children, key);
    if (child) return child;
  }
  return null;
}

function countNodes(nodes: HierarchyNode[]): number {
  return nodes.reduce(
    (count, node) => count + 1 + countNodes(node.children),
    0,
  );
}

export function HierarchyCard({
  hierarchy,
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
  const selectedNode = findNodeByKey(hierarchy, normalizedSelected);
  const totalNodeCount = countNodes(hierarchy);
  const selectedPath = selectedNode?.primPath ?? normalizedSelected;
  const selectedChildCount = selectedNode?.children.length ?? 0;
  const selectedPayloadState =
    selectedPath && payloadPrimPaths?.has(selectedPath)
      ? unloadedPayloadPaths?.has(selectedPath)
        ? "Deferred"
        : "Loaded"
      : null;

  return (
    <div className="hierarchy-card">
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
                  hasDescendant(node, normalizedSelected)
                }
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
      </section>

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
        {selectedNode ? (
          <div className="selected-kv">
            <div className="selected-kv-row">
              <span className="selected-kv-key">Name</span>
              <span className="selected-kv-value">
                {selectedNode.name || "(unnamed)"}
              </span>
            </div>
            <div className="selected-kv-row">
              <span className="selected-kv-key">Type</span>
              <span className="selected-kv-value is-muted">
                {selectedNode.kind}
              </span>
            </div>
            {selectedPath ? (
              <div className="selected-kv-row">
                <span className="selected-kv-key">Path</span>
                <span className="selected-kv-value is-muted">
                  {selectedPath}
                </span>
              </div>
            ) : null}
            <div className="selected-kv-row">
              <span className="selected-kv-key">Children</span>
              <span className="selected-kv-value">{selectedChildCount}</span>
            </div>
            {selectedPayloadState ? (
              <div className="selected-kv-row">
                <span className="selected-kv-key">Payload</span>
                <span className="selected-kv-value">
                  {selectedPayloadState}
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="sidebar-empty">Select a row to inspect node details.</p>
        )}
      </section>
    </div>
  );
}
