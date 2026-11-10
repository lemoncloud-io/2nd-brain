// tree 블록. 포함 관계를 중첩 상자로 그린다. 순환은 검사기가 막지만 화면도 자기 방어를 한다.

import type { TreeBlock, TreeNode } from '../../model/types.ts';
import { Inline } from '../app/inline.tsx';

function Box({
  node,
  kids,
  selectedId,
  onSelect,
  depth,
}: {
  node: TreeNode;
  kids: Map<string, TreeNode[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}): React.ReactElement {
  const children = kids.get(node.id) ?? [];
  return (
    <div className="tree__box" id={node.id} data-selected={selectedId === node.id ? 'true' : 'false'}>
      <button type="button" className="tree__label" onClick={() => onSelect(node.id)}>
        <Inline text={node.label} refs={false} />
        {node.tag ? <span className="chip">{node.tag}</span> : null}
      </button>
      {node.easy ? (
        <div className="tree__easy">
          <Inline text={node.easy} />
        </div>
      ) : null}
      {children.length > 0 && depth < 8 ? (
        <div className="tree__kids">
          {children.map((child) => (
            <Box key={child.id} node={child} kids={kids} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Tree({
  block,
  selectedId,
  onSelect,
}: {
  block: TreeBlock;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const ids = new Set(block.nodes.map((n) => n.id));
  const kids = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const node of block.nodes) {
    // parent가 없거나 목록 밖을 가리키면 최상위로 올린다 — 노드가 화면에서 사라지지 않게
    if (node.parent !== undefined && ids.has(node.parent)) {
      const list = kids.get(node.parent) ?? [];
      list.push(node);
      kids.set(node.parent, list);
    } else {
      roots.push(node);
    }
  }

  return (
    <div className="tree">
      {roots.map((root) => (
        <Box key={root.id} node={root} kids={kids} selectedId={selectedId} onSelect={onSelect} depth={0} />
      ))}
    </div>
  );
}
