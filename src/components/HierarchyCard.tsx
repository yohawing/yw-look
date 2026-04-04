import type { HierarchyNode } from "./assetMetadata";

type HierarchyCardProps = {
  hierarchy: HierarchyNode[];
};

function HierarchyBranch({ node }: { node: HierarchyNode }) {
  return (
    <li>
      <span className="tree-node-name">{node.name}</span>
      <span className="tree-node-kind">{node.kind}</span>
      {node.children.length > 0 ? (
        <ul className="tree-list">
          {node.children.map((child, index) => (
            <HierarchyBranch
              key={`${node.name}-${child.name}-${index}`}
              node={child}
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
      <p className="card-title">Hierarchy</p>
      {hierarchy.length > 0 ? (
        <ul className="tree-list">
          {hierarchy.map((node, index) => (
            <HierarchyBranch key={`${node.name}-${index}`} node={node} />
          ))}
        </ul>
      ) : (
        <p className="muted">
          No hierarchy is available for the current preview object yet.
        </p>
      )}
    </article>
  );
}
