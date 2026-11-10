// 용어 화면. 용어는 물려받을 블록이 없으므로 항상 자기 근거를 갖는다(docs/schema.md).

import { useState } from 'react';

import type { Bundle } from '../../model/types.ts';
import { Inline } from '../app/inline.tsx';

export function GlossaryPage({
  bundle,
  selectedId,
  onSelect,
}: {
  bundle: Bundle;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const terms = bundle.viewer.glossary ?? [];
  const needle = q.trim().toLowerCase();
  const shown = terms.filter(
    (t) =>
      needle === '' ||
      t.term.toLowerCase().includes(needle) ||
      t.easy.toLowerCase().includes(needle) ||
      (t.tech ?? '').toLowerCase().includes(needle),
  );

  return (
    <div className="page">
      <header className="page__head">
        <h2>용어</h2>
        <p className="page__intro">이 뷰어가 쓰는 말의 뜻. 항목을 누르면 근거가 열린다.</p>
      </header>

      {terms.length === 0 ? (
        <div className="empty">등록된 용어가 없다.</div>
      ) : (
        <>
          <div className="filters">
            <input
              className="input"
              type="search"
              placeholder="용어 찾기"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="용어 찾기"
            />
            <span className="filters__count">
              {shown.length}/{terms.length}
            </span>
          </div>
          <div className="glossary">
            {shown.map((term) => (
              <button
                type="button"
                className="term"
                key={term.id}
                id={term.id}
                aria-current={selectedId === term.id ? 'true' : undefined}
                onClick={() => onSelect(term.id)}
              >
                <span className="term__name">{term.term}</span>
                <span className="term__easy">
                  <Inline text={term.easy} refs={false} />
                </span>
                {term.tech ? (
                  <span className="term__tech">
                    기술적으로는 <Inline text={term.tech} refs={false} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
