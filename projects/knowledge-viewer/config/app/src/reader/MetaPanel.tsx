import { useEffect, useRef, useState } from 'react';

import type { DocResponse } from '../app/types.ts';

const KEYS = ['type', 'status', 'aliases', 'related', 'sources'] as const;

/** frontmatter 값을 줄 목록으로 편다. 없으면 빈 배열이다. */
export function toLines(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap(toLines);
  if (typeof v === 'object') return [JSON.stringify(v)];
  return [String(v)];
}

export function CopyPathButton({ path }: { path: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    navigator.clipboard.writeText(`@${path}`).then(
      () => {
        setDone(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <button type="button" className="copy-path" onClick={copy}>
      {done ? '복사됨' : '경로 복사'}
    </button>
  );
}

export function MetaPanel({ doc }: { doc: DocResponse }) {
  const rows = KEYS.map((k) => [k, toLines(doc.frontmatter[k])] as const).filter(([, v]) => v.length > 0);
  const { commit, dirty } = doc.stamp;
  return (
    <div className="meta">
      {rows.length > 0 && (
        <dl className="meta-list">
          {rows.map(([k, v]) => (
            <div key={k} className="meta-row">
              <dt>{k}</dt>
              <dd>
                {v.length === 1 ? (
                  v[0]
                ) : (
                  <ul>
                    {v.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="meta-stamp">
        {commit === null ? '커밋 없음' : `커밋 ${commit}`}
        {dirty && <span className="meta-dirty"> · 변경 있음</span>}
      </p>
      <CopyPathButton path={doc.path} />
    </div>
  );
}
