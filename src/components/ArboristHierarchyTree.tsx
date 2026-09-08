import {
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import {
  Tree,
  type NodeRendererProps,
  type RowRendererProps,
} from "react-arborist";
import {
  ChevronRightIcon,
  CircleIcon,
  DotFilledIcon,
} from "@radix-ui/react-icons";
import type { HierarchyNode } from "./assetMetadata";

type Props = {
  hierarchy: HierarchyNode[];
  searchTerm: string;
  selectedName: string | null;
  onSelectName?: (key: string | null) => void;
  onSelectPrimPath?: (path: string | null) => void;
  payloadPrimPaths?: ReadonlySet<string>;
  unloadedPayloadPaths?: ReadonlySet<string>;
  onLoadPayload?: (path: string) => void;
  onUnloadPayload?: (path: string) => void;
};
type Item = {
  id: string;
  source: HierarchyNode;
  path: string;
  children: Item[] | null;
};
const RowContext = createContext<Props | null>(null);

function adapt(
  nodes: HierarchyNode[],
  parentId = "root",
  parentPath = "/",
): Item[] {
  return nodes.map((source, index) => {
    const id = `${parentId}/${index}`;
    const path =
      source.primPath ??
      (!source.name
        ? parentPath
        : source.name.startsWith("/")
          ? source.name
          : `${parentPath === "/" ? "" : parentPath}/${source.name}`);
    return {
      id,
      source,
      path,
      children: source.children.length
        ? adapt(source.children, id, path)
        : null,
    };
  });
}

export function ArboristHierarchyTree(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 360 });
  const data = useMemo(() => adapt(props.hierarchy), [props.hierarchy]);
  const index = useMemo(() => {
    const initialOpenState: Record<string, boolean> = {};
    const items: Item[] = [];
    const visit = (nodes: Item[], depth = 0) => {
      for (const item of nodes) {
        items.push(item);
        initialOpenState[item.id] = depth < 2;
        if (item.children) visit(item.children, depth + 1);
      }
    };
    visit(data);
    return { items, initialOpenState };
  }, [data]);
  const selectedId = index.items.find(
    (item) => (item.source.primPath ?? item.source.name) === props.selectedName,
  )?.id;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0)
        setSize((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const term = props.searchTerm.trim().toLocaleLowerCase();
  const hasMatches = index.items.some((item) =>
    (item.source.displayName || item.source.name || "(unnamed)")
      .toLocaleLowerCase()
      .includes(term),
  );
  return (
    <RowContext.Provider value={props}>
      <div className="hierarchy-tree-scroll" ref={host}>
        {!data.length ? (
          <p className="sidebar-empty">
            No hierarchy available for the current asset.
          </p>
        ) : (
          <>
            {!hasMatches && (
              <p className="sidebar-empty">No hierarchy nodes match.</p>
            )}
            <Tree<Item>
              data={data}
              renderRow={ArboristRow}
              width={size.width}
              height={size.height}
              rowHeight={24}
              indent={0}
              overscanCount={6}
              openByDefault={false}
              initialOpenState={index.initialOpenState}
              selection={selectedId}
              searchTerm={term}
              searchMatch={(node, query) =>
                (
                  node.data.source.displayName ||
                  node.data.source.name ||
                  "(unnamed)"
                )
                  .toLocaleLowerCase()
                  .includes(query)
              }
              disableDrag
              disableDrop
              disableEdit
              selectionFollowsFocus
              disableMultiSelection
              disableSelect={(item) => !item.source.name}
              aria-label="Outliner"
              onSelect={(nodes) => {
                const item = nodes[0]?.data;
                if (!item) return;
                const key = item.source.primPath ?? item.source.name;
                if (key && key !== props.selectedName) {
                  props.onSelectName?.(key);
                  props.onSelectPrimPath?.(item.path);
                }
              }}
            >
              {HierarchyRow}
            </Tree>
          </>
        )}
      </div>
    </RowContext.Provider>
  );
}

function HierarchyRow({ node: nodeApi, style, tree }: NodeRendererProps<Item>) {
  const {
    selectedName,
    onSelectName,
    onSelectPrimPath,
    payloadPrimPaths,
    unloadedPayloadPaths,
    onLoadPayload,
    onUnloadPayload,
  } = useContext(RowContext)!;
  const node = nodeApi.data.source;
  const primPath = nodeApi.data.path;
  const nodeSelectionKey = node.primPath ?? node.name;
  const isSelected = selectedName !== null && selectedName === nodeSelectionKey;
  const hasChildren = nodeApi.isInternal;
  const showChildren = nodeApi.isOpen;
  const isPayloadSource = payloadPrimPaths?.has(primPath);
  const isUnloadedPayload =
    isPayloadSource && unloadedPayloadPaths?.has(primPath);
  const isLoadedPayload = isPayloadSource && !isUnloadedPayload;
  return (
    <div
      className={`tree-row${isSelected ? " is-selected" : ""}${
        onSelectName && node.name ? " is-clickable" : ""
      }`}
      style={{ ...style, paddingLeft: 6 }}
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
              if (isSelected) {
                nodeApi.deselect();
                onSelectName(null);
                onSelectPrimPath?.(null);
              } else {
                nodeApi.select();
              }
            }
          : undefined
      }
    >
      {hasChildren ? (
        <button
          className="tree-chevron"
          onClick={(event) => {
            event.stopPropagation();
            nodeApi.toggle();
          }}
          disabled={Boolean(tree.props.searchTerm)}
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
      <span className="tree-node-name">
        {node.displayName || node.name || "(unnamed)"}
      </span>
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
  );
}

// Keep the existing ellipsis layout rather than Arborist's max-content rows.
function ArboristRow({
  node,
  attrs,
  innerRef,
  children,
}: RowRendererProps<Item>) {
  return (
    <div
      {...attrs}
      style={{ ...attrs.style, minWidth: 0 }}
      ref={innerRef}
      onFocus={(event) => event.stopPropagation()}
      onClick={node.handleClick}
    >
      {children}
    </div>
  );
}
