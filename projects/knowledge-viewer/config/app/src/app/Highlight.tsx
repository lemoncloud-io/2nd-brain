// 일치 범위를 <mark> 로 감싼다. 범위는 코드포인트 단위(title-match 와 같다)라 Array.from 으로 자른다.
import type { ReactNode } from 'react';

import type { Range } from './title-match.ts';

export function Highlight({ text, ranges }: { text: string; ranges: readonly Range[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const chars = Array.from(text.normalize('NFC'));
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(chars.slice(at, s).join(''));
    out.push(
      <mark key={i} className="hl">
        {chars.slice(s, e).join('')}
      </mark>,
    );
    at = e;
  });
  if (at < chars.length) out.push(chars.slice(at).join(''));
  return <>{out}</>;
}
