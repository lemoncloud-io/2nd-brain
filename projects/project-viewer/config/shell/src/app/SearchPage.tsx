// 검색 결과. 색인과 점수는 search.ts(순수)가 만들고 여기서는 보여 주기만 한다.

import { useMemo } from 'react';

import { formatRoute } from './router.ts';
import { kindLabel, search } from './search.ts';
import type { SearchEntry } from './search.ts';

export function SearchPage({ index, q }: { index: SearchEntry[]; q: string }): React.ReactElement {
  const hits = useMemo(() => search(index, q), [index, q]);

  return (
    <div className="page">
      <header className="page__head">
        <h2>검색</h2>
        <p className="page__intro">
          “{q}” — <span className="nums">{hits.length}</span>건. 페이지 항목·용어·원본 본문을 한꺼번에 찾는다.
        </p>
      </header>

      {hits.length === 0 ? (
        <div className="empty">찾은 것이 없다.</div>
      ) : (
        <div className="hits">
          {hits.map((hit) => (
            <a className="hit" key={`${hit.entry.kind}:${hit.entry.id}`} href={formatRoute(hit.entry.route)}>
              <span className="hit__top">
                <span className="chip">{kindLabel(hit.entry.kind)}</span>
                <span className="hit__title">{hit.entry.title}</span>
                <span className="muted">{hit.entry.where}</span>
              </span>
              {hit.snippet ? <span className="hit__snippet">{hit.snippet}</span> : null}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
