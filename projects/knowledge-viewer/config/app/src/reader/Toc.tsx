import { useRef } from 'react';

import type { DocChange, Heading } from '../app/types.ts';
import { changedHeadings } from './toc-changed.ts';
import { useActiveHeading, useFollowActive } from './useActiveHeading.ts';

type Props = {
  headings: Heading[];
  /** PR 이 이 문서에 한 일(hunk·지운 자리). 없으면 점이 없다. */
  change?: Pick<DocChange, 'hunks' | 'removed'>;
  /** 문서 마지막 줄(파일 기준). 마지막 절의 끝이다. */
  endLine?: number;
};

/**
 * 목차. 링크는 `#slug`만 쓰므로 주소의 경로·에이전트 질의는 그대로 남는다. PR 이 바꾼 절의 헤딩엔 점을 단다.
 * 가운데 열을 스크롤하면 지금 읽는 절을 `li.toc-active` 로 표시하고, 그 항목이 패널 밖이면 패널만 따라 스크롤한다.
 */
export function Toc({ headings, change, endLine = Number.MAX_SAFE_INTEGER }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const { active, pin } = useActiveHeading(headings);
  useFollowActive(listRef, active, headings);
  if (headings.length === 0) return <p className="panel-empty">제목 없음</p>;
  const base = Math.min(...headings.map((h) => h.depth));
  const dotted = change === undefined ? new Set<number>() : changedHeadings(headings, change.hunks, change.removed, endLine);
  return (
    <ul className="toc" ref={listRef}>
      {headings.map((h, i) => (
        <li key={`${h.slug}-${i}`} className={i === active ? 'toc-active' : undefined} style={{ paddingLeft: `${(h.depth - base) * 12}px` }}>
          <a href={`#${h.slug}`} aria-current={i === active ? 'location' : undefined} onClick={() => pin(i)}>
            {dotted.has(i) ? <span className="toc-dot" role="img" aria-label="변경" /> : null}
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
