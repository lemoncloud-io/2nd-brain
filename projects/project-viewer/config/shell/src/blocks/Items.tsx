// items 블록. 태그·텍스트로 걸러 보고, refs는 그 항목으로 가는 링크가 된다.

import { useMemo, useState } from 'react';

import type { ItemsBlock } from '../../model/types.ts';
import { Inline } from '../app/inline.tsx';

export function Items({
  block,
  selectedId,
  onSelect,
  labelOf,
}: {
  block: ItemsBlock;
  selectedId: string | null;
  onSelect: (id: string) => void;
  labelOf: (id: string) => string;
}): React.ReactElement {
  const [tag, setTag] = useState('');
  const [text, setText] = useState('');

  const tags = useMemo(() => {
    const seen = new Set<string>();
    for (const item of block.items) for (const t of item.tags ?? []) seen.add(t);
    return [...seen];
  }, [block]);

  const needle = text.trim().toLowerCase();
  const shown = block.items.filter(
    (item) =>
      (tag === '' || (item.tags ?? []).includes(tag)) &&
      (needle === '' ||
        item.label.toLowerCase().includes(needle) ||
        (item.body ?? '').toLowerCase().includes(needle) ||
        item.id.toLowerCase().includes(needle)),
  );

  return (
    <div className="stack">
      {(tags.length > 0 || block.items.length > 6) && (
        <div className="filters">
          {tags.length > 0 ? (
            <>
              <button type="button" className="btn" aria-pressed={tag === ''} onClick={() => setTag('')}>
                전체
              </button>
              {tags.map((t) => (
                <button
                  type="button"
                  className="btn"
                  key={t}
                  aria-pressed={tag === t}
                  onClick={() => setTag(tag === t ? '' : t)}
                >
                  {t}
                </button>
              ))}
            </>
          ) : null}
          <input
            className="input"
            type="search"
            placeholder="항목 안에서 찾기"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="항목 텍스트 필터"
          />
          <span className="filters__count">
            {shown.length}/{block.items.length}
          </span>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">조건에 맞는 항목이 없다.</div>
      ) : (
        <div className="items">
          {shown.map((item) => (
            <div className="pick" key={item.id} id={item.id} aria-current={selectedId === item.id ? 'true' : undefined}>
              <button
                type="button"
                className="pick__label"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                onClick={() => onSelect(item.id)}
              >
                <span className="chip chip--code">{item.id}</span>
                <Inline text={item.label} refs={false} />
                {(item.tags ?? []).map((t) => (
                  <span className="chip" key={t}>
                    {t}
                  </span>
                ))}
              </button>
              {item.body ? (
                <div className="pick__body">
                  <Inline text={item.body} />
                </div>
              ) : null}
              {item.refs && item.refs.length > 0 ? (
                <div className="items__refs">
                  <span className="muted">관련</span>
                  {item.refs.map((ref) => (
                    <button type="button" className="cellbtn" key={ref} onClick={() => onSelect(ref)}>
                      {labelOf(ref)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
