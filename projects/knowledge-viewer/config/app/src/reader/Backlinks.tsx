import { hrefFor } from '../app/route.ts';
import { isPlainClick } from '../app/links.ts';
import type { Backlink, Source } from '../app/types.ts';

export type BacklinksProps = {
  items: Backlink[];
  agent: boolean;
  src: Source;
  onNavigate: (path: string, anchor?: string) => void;
};

/** 이 문서를 가리키는 문서 목록. 항목은 문서마다 하나고, 여러 번 걸었으면 수를 붙인다. */
export function Backlinks({ items, agent, src, onNavigate }: BacklinksProps) {
  if (items.length === 0) return <p className="panel-empty">역링크 없음</p>;
  return (
    <ul className="backlinks">
      {items.map((b) => (
        <li key={b.path}>
          <a
            href={hrefFor(b.path, undefined, agent, src)}
            data-vault-path={b.path}
            onClick={(e) => {
              if (!isPlainClick(e)) return;
              e.preventDefault();
              onNavigate(b.path);
            }}
          >
            <span className="backlink-title">{b.title}</span>
            <span className="backlink-path">{b.path}</span>
            {b.count > 1 && <span className="backlink-count">×{b.count}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}
