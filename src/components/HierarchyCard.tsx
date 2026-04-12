import { useState } from "react";
import type { HierarchyNode } from "./assetMetadata";

type HierarchyCardProps = {
  hierarchy: HierarchyNode[];
};

function HierarchyBranch({
  node,
  depth,
}: {
  node: HierarchyNode;
  depth: number;
}) {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <li className="tree-item">
      <div className="tree-row">
        {hasChildren ? (
          <button
            className="tree-chevron"
            onClick={() => setExpanded((v) => !v)}
            type="button"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              className={expanded ? "tree-chevron-open" : ""}
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
      {hasChildren && expanded ? (
        <ul className="tree-children">
          {node.children.map((child, index) => (
            <HierarchyBranch
              key={`${node.name}-${child.name}-${index}`}
              node={child}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function HierarchyCard({ hierarchy }: HierarchyCardProps) {
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
            />
          ))}
        </ul>
      ) : (
        <p className="muted">No hierarchy available for the current asset.</p>
      )}
    </article>
  );
}
