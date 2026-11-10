// 오른쪽 목차. 헤딩이 4개 이상일 때만 나온다 — 그보다 적으면 본문이 이미 한눈에 들어온다.

import { useEffect, useState } from 'react';

import type { Heading } from '../../model/types.ts';
import { formatRoute } from '../app/router.ts';
import { scrollToId } from '../app/useRoute.ts';

export const TOC_MIN = 4;

export function Toc({
  headings,
  sourceId,
  onNavigate,
}: {
  headings: Heading[];
  sourceId: string;
  onNavigate?: () => void;
}): React.ReactElement | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length < TOC_MIN) return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        // 화면에 걸친 절이 여럿이면 문서 순서에서 가장 위의 것을 현재로 본다.
        const first = headings.find((h) => seen.get(h.slug) === true);
        if (first !== undefined) setActive(first.slug);
      },
      // 상단 메뉴에 가린 부분은 "보이는 것"으로 치지 않는다.
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );
    for (const h of headings) {
      const el = document.getElementById(h.slug);
      if (el !== null) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < TOC_MIN) return null;

  return (
    <nav className="reader__toc" aria-label="이 문서의 목차">
      <h3 className="reader__toc-title">목차</h3>
      <ul>
        {headings.map((h) => (
          <li key={h.slug} className={`toc__item toc__item--d${Math.min(h.depth, 4)}`}>
            <a
              href={formatRoute({ kind: 'docs', sourceId, slug: h.slug })}
              aria-current={active === h.slug ? 'true' : undefined}
              onClick={(e) => {
                // 주소는 바꾸되 이동은 JS로 한다(네이티브 앵커가 막힌 환경 대응).
                e.preventDefault();
                try {
                  window.history.replaceState(null, '', formatRoute({ kind: 'docs', sourceId, slug: h.slug }));
                } catch {
                  // 불투명 출처에서는 주소를 못 바꾼다. 이동은 아래 스크롤이 한다.
                }
                scrollToId(h.slug);
                onNavigate?.();
              }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
