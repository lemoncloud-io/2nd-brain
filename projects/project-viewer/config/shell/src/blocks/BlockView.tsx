// 블록 한 덩이의 껍데기 + type에 따른 분기. 블록 8종이 여기서 갈린다.

import type { Block, Bundle } from '../../model/types.ts';
import { InlineParagraphs } from '../app/inline.tsx';
import { Graph } from './Graph.tsx';
import { Items } from './Items.tsx';
import { Mermaid } from './Mermaid.tsx';
import { Prose } from './Prose.tsx';
import { Sequence } from './Sequence.tsx';
import { Stages } from './Stages.tsx';
import { Table } from './Table.tsx';
import { Tree } from './Tree.tsx';

export function BlockView({
  bundle,
  block,
  selectedId,
  onSelect,
  labelOf,
}: {
  bundle: Bundle;
  block: Block;
  selectedId: string | null;
  onSelect: (id: string) => void;
  labelOf: (id: string) => string;
}): React.ReactElement {
  return (
    <section className="block" id={block.id}>
      {block.title || block.intro ? (
        <header className="block__head">
          {block.title ? (
            <div className="block__title">
              <h3>{block.title}</h3>
              {block.id && block.evidence && block.evidence.length > 0 ? (
                <button type="button" className="btn" onClick={() => onSelect(block.id!)}>
                  근거
                </button>
              ) : null}
            </div>
          ) : null}
          {block.intro ? <InlineParagraphs text={block.intro} className="block__intro" /> : null}
        </header>
      ) : null}

      {block.type === 'graph' ? <Graph block={block} selectedId={selectedId} onSelect={onSelect} /> : null}
      {block.type === 'tree' ? <Tree block={block} selectedId={selectedId} onSelect={onSelect} /> : null}
      {block.type === 'sequence' ? <Sequence block={block} selectedId={selectedId} onSelect={onSelect} /> : null}
      {block.type === 'stages' ? (
        <Stages bundle={bundle} block={block} selectedId={selectedId} onSelect={onSelect} />
      ) : null}
      {block.type === 'items' ? (
        <Items block={block} selectedId={selectedId} onSelect={onSelect} labelOf={labelOf} />
      ) : null}
      {block.type === 'table' ? <Table block={block} selectedId={selectedId} onSelect={onSelect} /> : null}
      {block.type === 'mermaid' ? <Mermaid block={block} /> : null}
      {block.type === 'prose' ? <Prose block={block} /> : null}
    </section>
  );
}
