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

  return (
    <li
      className={`tree-item${isSelected ? " is-selected" : ""}`}
      ref={isSelected ? selectedRef : undefined}
    >
      <div
        className={`tree-row${isSelected ? " is-selected" : ""}${
          onSelectName && node.name ? " is-clickable" : ""
        }`}
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

export function HierarchyCard({
  hierarchy,
  selectedName,
  onSelectName,
  onSelectPrimPath,
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

  return (
    <article className="card hierarchy-card">
      <p className="card-title">Scene Hierarchy</p>
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
            />
          ))}
        </ul>
      ) : (
        <p className="muted">No hierarchy available for the current asset.</p>
      )}
    </article>
  );
}
